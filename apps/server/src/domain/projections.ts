import {
  STALE_AFTER_MINUTES, BED_TYPES, computeEtas, formatToken, rollingAverage, vacancyBand,
  type AdminOverviewDTO, type BedAggregateItem, type BedBoardDTO, type BedDTO, type DepartmentDTO, type DoctorDTO,
  type EtaResult, type PublicQueueDTO, type StaffQueueDTO, type StaffTokenRow, type TokenViewDTO, type WardDTO,
} from "@smartopd/shared";
import { prisma, serviceDateFor } from "../db";
import { AppError } from "../errors";
import { simulatorState } from "../sim/state";

export async function lastSeq(): Promise<number> {
  const r = await prisma.$queryRaw<{ last_value: bigint }[]>`SELECT last_value FROM "event_seq"`;
  return Number(r[0]?.last_value ?? 0);
}

export async function nextSeq(): Promise<number> {
  const r = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('event_seq') AS n`;
  return Number(r[0]!.n);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const toDeptDTO = (d: { id: string; name: string; code: string; avgConsultMinutes: number }): DepartmentDTO => ({
  id: d.id, name: d.name, code: d.code, avgConsultMinutes: d.avgConsultMinutes,
});

const toDoctorDTO = (d: { id: string; name: string; room: string; departmentId: string; status: DoctorDTO["status"]; currentTokenId: string | null }): DoctorDTO => ({
  id: d.id, name: d.name, room: d.room, departmentId: d.departmentId, status: d.status, currentTokenId: d.currentTokenId,
});

let deptCache: { at: number; rows: DepartmentDTO[] } | null = null;
/** Departments almost never change, so serve them from memory for 60 s. */
export async function listDepartments(): Promise<DepartmentDTO[]> {
  if (deptCache && Date.now() - deptCache.at < 60_000) return deptCache.rows;
  const rows = (await prisma.department.findMany({ orderBy: { name: "asc" } })).map(toDeptDTO);
  deptCache = { at: Date.now(), rows };
  return rows;
}

export async function loadDepartmentState(deptId: string) {
  const date = serviceDateFor();
  const dept = await prisma.department.findUnique({ where: { id: deptId } });
  if (!dept) throw new AppError("NOT_FOUND", "We couldn't find that department.");

  const [open, recent, doctors, finished] = await Promise.all([
    prisma.token.findMany({
      where: { departmentId: deptId, serviceDate: date, status: { in: ["WAITING", "CALLED", "IN_CONSULT"] } },
      include: { patient: true },
    }),
    prisma.token.findMany({
      where: { departmentId: deptId, serviceDate: date, status: { in: ["COMPLETED", "TRANSFERRED_TO_LAB", "NO_SHOW", "CANCELLED"] } },
      include: { patient: true },
      orderBy: { completedAt: "desc" },
      take: 6,
    }),
    prisma.doctor.findMany({ where: { departmentId: deptId }, orderBy: { room: "asc" } }),
    prisma.token.findMany({
      where: { departmentId: deptId, status: { in: ["COMPLETED", "TRANSFERRED_TO_LAB"] }, startedAt: { not: null }, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 5,
      select: { startedAt: true, completedAt: true },
    }),
  ]);

  const durations = finished.map((t) => (t.completedAt!.getTime() - t.startedAt!.getTime()) / 60000);
  const avg = rollingAverage(durations, dept.avgConsultMinutes);
  const activeDoctorIds = doctors.filter((d) => d.status === "AVAILABLE" || d.status === "WITH_PATIENT").map((d) => d.id);
  const etas = computeEtas({ tokens: open, activeDoctorIds, avgConsultMinutes: avg, now: new Date() });
  const etaById = new Map<string, EtaResult>(etas.map((e) => [e.tokenId, e]));
  return { dept, open, recent, doctors, avg, activeDoctorIds, etaById };
}
export type DepartmentState = Awaited<ReturnType<typeof loadDepartmentState>>;

const byId = (s: DepartmentState) => new Map(s.doctors.map((d) => [d.id, d]));
const label = (s: DepartmentState, t: { tokenNumber: number }) => formatToken(s.dept.code, t.tokenNumber);

export function toPublicQueue(s: DepartmentState, seq: number): PublicQueueDTO {
  const docs = byId(s);
  const nowServing = s.open
    .filter((t) => t.status === "CALLED" || t.status === "IN_CONSULT")
    .sort((a, b) => (a.calledAt?.getTime() ?? 0) - (b.calledAt?.getTime() ?? 0))
    .map((t) => ({ label: label(s, t), room: docs.get(t.doctorId ?? "")?.room ?? "", status: t.status }));
  const waiting = s.open
    .filter((t) => t.status === "WAITING")
    .map((t) => ({ t, e: s.etaById.get(t.id)! }))
    .sort((a, b) => a.e.position - b.e.position)
    .map(({ t, e }) => ({ label: label(s, t), priority: t.priority, position: e.position, etaMinutes: e.etaMinutes }));
  return {
    seq, department: toDeptDTO(s.dept), nowServing, waiting, waitingCount: waiting.length,
    activeDoctors: s.activeDoctorIds.length, avgConsultMinutes: Math.round(s.avg), nextEtaMinutes: waiting[0]?.etaMinutes ?? null,
  };
}

export function toStaffQueue(s: DepartmentState, seq: number): StaffQueueDTO {
  const docs = byId(s);
  const row = (t: DepartmentState["open"][number]): StaffTokenRow => {
    const e = s.etaById.get(t.id);
    return {
      id: t.id, label: label(s, t), status: t.status, priority: t.priority,
      patientName: t.patient.name, age: t.patient.age, checkedInAt: t.checkedInAt.toISOString(),
      calledAt: iso(t.calledAt), startedAt: iso(t.startedAt), completedAt: iso(t.completedAt),
      doctorId: t.doctorId, room: docs.get(t.doctorId ?? "")?.room ?? null,
      position: e?.position ?? null, ahead: e?.ahead ?? null, etaMinutes: e?.etaMinutes ?? null, estimatedCallTime: e?.estimatedCallTime ?? null,
    };
  };
  const waiting = s.open.filter((t) => t.status === "WAITING").map(row).sort((a, b) => a.position! - b.position!);
  return {
    seq, department: toDeptDTO(s.dept),
    active: s.open.filter((t) => t.status !== "WAITING").map(row),
    waiting, recent: s.recent.map(row), doctors: s.doctors.map(toDoctorDTO),
    avgConsultMinutes: Math.round(s.avg), activeDoctors: s.activeDoctorIds.length,
  };
}

export function toTokenView(s: DepartmentState, tokenId: string, seq: number): TokenViewDTO | null {
  const t = [...s.open, ...s.recent].find((x) => x.id === tokenId);
  if (!t) return null;
  const doc = s.doctors.find((d) => d.id === t.doctorId);
  const e = s.etaById.get(t.id);
  const serving = s.open
    .filter((x) => x.status === "CALLED" || x.status === "IN_CONSULT")
    .sort((a, b) => (b.calledAt?.getTime() ?? 0) - (a.calledAt?.getTime() ?? 0))[0];
  return {
    seq, id: t.id, label: label(s, t), status: t.status, priority: t.priority, department: toDeptDTO(s.dept),
    patientFirstName: t.patient.name.split(" ")[0] ?? t.patient.name,
    position: e?.position ?? null, ahead: e?.ahead ?? null, etaMinutes: e?.etaMinutes ?? null, estimatedCallTime: e?.estimatedCallTime ?? null,
    room: doc?.room ?? null, doctorName: doc?.name ?? null, nowServing: serving ? label(s, serving) : null,
    doctorsOnDuty: s.activeDoctorIds.length, missedCount: t.missedCount,
    checkedInAt: t.checkedInAt.toISOString(), calledAt: iso(t.calledAt), startedAt: iso(t.startedAt), completedAt: iso(t.completedAt),
  };
}

/** Finds a token (any day) and its department id; used for token pages. */
export async function tokenDepartment(tokenId: string): Promise<string | null> {
  const t = await prisma.token.findUnique({ where: { id: tokenId }, select: { departmentId: true } }).catch(() => null);
  return t?.departmentId ?? null;
}

export async function loadTokenView(tokenId: string, seq: number): Promise<TokenViewDTO> {
  const deptId = await tokenDepartment(tokenId);
  if (!deptId) throw new AppError("NOT_FOUND", "We couldn't find that token.");
  const state = await loadDepartmentState(deptId);
  let view = toTokenView(state, tokenId, seq);
  if (!view) {
    // an older token that has dropped out of the "recent" window
    const t = await prisma.token.findUnique({ where: { id: tokenId }, include: { patient: true, doctor: true } });
    if (!t) throw new AppError("NOT_FOUND", "We couldn't find that token.");
    view = {
      seq, id: t.id, label: label(state, t), status: t.status, priority: t.priority, department: toDeptDTO(state.dept),
      patientFirstName: t.patient.name.split(" ")[0] ?? t.patient.name, position: null, ahead: null, etaMinutes: null,
      estimatedCallTime: null, room: t.doctor?.room ?? null, doctorName: t.doctor?.name ?? null, nowServing: null,
      doctorsOnDuty: state.activeDoctorIds.length, missedCount: t.missedCount, checkedInAt: t.checkedInAt.toISOString(), calledAt: iso(t.calledAt),
      startedAt: iso(t.startedAt), completedAt: iso(t.completedAt),
    };
  }
  return view;
}

export const toBedDTO = (b: { id: string; wardId: string; bedNumber: string; status: BedDTO["status"]; patientName: string | null; version: number; updatedAt: Date; updatedBy: string | null }): BedDTO => ({
  id: b.id, wardId: b.wardId, bedNumber: b.bedNumber, status: b.status, patientName: b.patientName,
  version: b.version, updatedAt: b.updatedAt.toISOString(), updatedBy: b.updatedBy,
});

export async function loadBedBoard(seq: number): Promise<BedBoardDTO> {
  const wardsRaw = await prisma.ward.findMany({ include: { beds: true }, orderBy: { name: "asc" } });
  const now = Date.now();
  const wards: WardDTO[] = wardsRaw.map((w) => {
    const count = (s: string) => w.beds.filter((b) => b.status === s).length;
    const lastChange = w.beds.reduce<number>((m, b) => Math.max(m, b.updatedAt.getTime()), 0);
    return {
      id: w.id, name: w.name, type: w.type, totalBeds: w.beds.length,
      vacant: count("VACANT"), occupied: count("OCCUPIED"), cleaning: count("CLEANING"), reserved: count("RESERVED"),
      verifiedAt: iso(w.verifiedAt), verifiedBy: w.verifiedBy, lastChangeAt: lastChange ? new Date(lastChange).toISOString() : null,
    };
  });
  const aggregates: BedAggregateItem[] = BED_TYPES.map((type) => {
    const ws = wards.filter((w) => w.type === type);
    const vacant = ws.reduce((s, w) => s + w.vacant, 0);
    const total = ws.reduce((s, w) => s + w.totalBeds, 0);
    const confirmed = ws.map((w) => Math.max(w.verifiedAt ? Date.parse(w.verifiedAt) : 0, w.lastChangeAt ? Date.parse(w.lastChangeAt) : 0));
    const fresh = confirmed.length && confirmed.every((c) => c > 0) ? Math.min(...confirmed) : null;
    return {
      type, vacant, total, band: vacancyBand(vacant, total),
      freshAt: fresh ? new Date(fresh).toISOString() : null,
      stale: fresh === null || now - fresh > STALE_AFTER_MINUTES * 60000,
    };
  });
  return { seq, aggregates, wards, serverTime: new Date().toISOString() };
}

export async function loadAdminBeds(): Promise<{ wards: WardDTO[]; beds: BedDTO[] }> {
  const board = await loadBedBoard(0);
  const beds = await prisma.bed.findMany({ orderBy: [{ wardId: "asc" }, { bedNumber: "asc" }] });
  return { wards: board.wards, beds: beds.map(toBedDTO) };
}

export async function loadAdminOverview(seq: number): Promise<AdminOverviewDTO> {
  const depts = await prisma.department.findMany({ orderBy: { name: "asc" } });
  const states = await Promise.all(depts.map((d) => loadDepartmentState(d.id)));
  const now = Date.now();
  return {
    seq,
    departments: states.map((s) => {
      const waiting = s.open.filter((t) => t.status === "WAITING");
      const oldest = waiting.reduce<number>((m, t) => Math.min(m, t.checkedInAt.getTime()), now);
      return {
        department: toDeptDTO(s.dept), waiting: waiting.length, active: s.open.length - waiting.length,
        longestWaitMinutes: waiting.length ? Math.floor((now - oldest) / 60000) : 0,
        avgConsultMinutes: Math.round(s.avg), doctorsOnDuty: s.activeDoctorIds.length,
      };
    }),
    doctors: states.flatMap((s) => s.doctors.map((d) => ({ ...toDoctorDTO(d), departmentName: s.dept.name }))),
    simulator: { enabled: simulatorState.enabled },
    serverTime: new Date().toISOString(),
  };
}
