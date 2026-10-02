import { formatToken } from "@smartopd/shared";
import { config } from "../config";
import { prisma } from "../db";
import type { DepartmentState } from "../domain/projections";
import { deliver } from "./alerts";

const COPY = {
  SECOND: { subject: (l: string) => `You're 2nd in line (${l})`, line: "You're 2nd in line. Please be ready, your turn is approaching." },
  NEXT: { subject: (l: string) => `You're next! (${l})`, line: "You're next! Please proceed toward the consultation area." },
} as const;

const mask = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");

/**
 * When a waiting patient's live position reaches 2nd, then 1st, email them once each.
 * Only patients who gave an email at booking are mailed. Each alert is claimed atomically,
 * so repeated publishes never send twice. (The token page shows the same alerts in-app.)
 */
export async function notifyQueuePositions(state: DepartmentState): Promise<void> {
  for (const t of state.open) {
    if (t.status !== "WAITING") continue;
    const position = state.etaById.get(t.id)?.position;
    if (position !== 1 && position !== 2) continue;

    const level = position === 1 ? "NEXT" : "SECOND";
    const claim = await prisma.token.updateMany({
      where: position === 1 ? { id: t.id, notified1: false } : { id: t.id, notified2: false, notified1: false },
      data: position === 1 ? { notified1: true, notified2: true } : { notified2: true },
    });
    const email = t.patient.email;
    if (claim.count !== 1 || !email) continue;

    const label = formatToken(state.dept.code, t.tokenNumber);
    const first = t.patient.name.split(" ")[0];
    const link = config.publicWebUrl ? `\n\nWatch your place live: ${config.publicWebUrl}/token/${t.id}` : "";
    const text = `Hi ${first},\n\n${COPY[level].line}\n\nToken ${label} · ${state.dept.name} · ${config.HOSPITAL_NAME}${link}\n\nDemo hospital: this is a hackathon prototype, not a clinical system.`;
    const status = await deliver(email, `[SmartOPD] ${COPY[level].subject(label)}`, text);
    await prisma.auditLog.create({
      data: { actor: "system", action: "alert.patient_email", entity: "Token", entityId: t.id, after: { label, level, status, to: mask(email) } },
    });
  }
}
