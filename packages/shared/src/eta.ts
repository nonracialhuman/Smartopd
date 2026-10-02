import { PRIORITY_RANK, type Priority, type TokenStatus } from "./domain";

export interface EtaToken {
  id: string;
  priority: Priority;
  status: TokenStatus;
  checkedInAt: Date | string | number;
  doctorId?: string | null;
  startedAt?: Date | string | number | null;
  calledAt?: Date | string | number | null;
}

export interface EtaResult {
  tokenId: string;
  position: number;
  ahead: number;
  etaMinutes: number | null;
  estimatedCallTime: string | null;
}

const ms = (d: Date | string | number) => new Date(d).getTime();

export function compareQueue(a: Pick<EtaToken, "priority" | "checkedInAt">, b: Pick<EtaToken, "priority" | "checkedInAt">): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  return p !== 0 ? p : ms(a.checkedInAt) - ms(b.checkedInAt);
}

export function rollingAverage(recentMinutes: number[], fallback: number, window = 5): number {
  const recent = recentMinutes.filter((m) => Number.isFinite(m) && m > 0).slice(0, window);
  const avg = recent.length ? recent.reduce((s, m) => s + m, 0) / recent.length : fallback;
  return Math.min(60, Math.max(2, avg));
}

export function computeEtas(input: {
  tokens: EtaToken[];
  activeDoctorIds: string[];
  avgConsultMinutes: number;
  now: Date;
}): EtaResult[] {
  const { tokens, activeDoctorIds, avgConsultMinutes: avg, now } = input;
  const nowMs = now.getTime();
  const waiting = tokens.filter((t) => t.status === "WAITING").sort(compareQueue);

  if (activeDoctorIds.length === 0) {
    return waiting.map((t, i) => ({ tokenId: t.id, position: i + 1, ahead: i, etaMinutes: null, estimatedCallTime: null }));
  }

  // minutes from now until each doctor is free
  const free = activeDoctorIds.map((id) => {
    const t = tokens.find((x) => x.doctorId === id && (x.status === "IN_CONSULT" || x.status === "CALLED"));
    if (!t) return 0;
    if (t.status === "CALLED") return avg;
    const elapsed = t.startedAt ? (nowMs - ms(t.startedAt)) / 60000 : 0;
    return Math.max(1, avg - elapsed);
  });

  return waiting.map((t, i) => {
    let k = 0;
    for (let j = 1; j < free.length; j++) if (free[j]! < free[k]!) k = j;
    const eta = Math.max(0, free[k]!);
    free[k] = eta + avg;
    return {
      tokenId: t.id,
      position: i + 1,
      ahead: i,
      etaMinutes: Math.round(eta),
      estimatedCallTime: new Date(nowMs + eta * 60000).toISOString(),
    };
  });
}
