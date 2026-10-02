import {
  ALERT_PRIORITIES, canTransition, formatToken,
  type BedUpdateInput, type CallNextInput, type DoctorStatusInput, type Priority, type RetriageInput,
  type TokenCreateInput, type TokenStatus, type WardVerifyInput,
} from "@smartopd/shared";
import { prisma, serviceDateFor, type Tx } from "../db";
import { Actor, AppError, actorName, requireRole } from "../errors";
import type { Effect, Outcome } from "./effects";

const audit = (tx: Tx, actor: Actor, action: string, entity: string, entityId: string, before: unknown, after: unknown) =>
  tx.auditLog.create({
    data: { actor: actorName(actor), action, entity, entityId, before: (before ?? undefined) as never, after: (after ?? undefined) as never },
  });

// ---------------------------------------------------------------- check-in

export type CreateTokenInput = Omit<TokenCreateInput, "otpChallengeId" | "otpCode" | "priority"> & {
  priority: Priority;
  otpChallengeId?: string;
  otpCode?: string;
};

async function consumeOtp(tx: Tx, input: CreateTokenInput): Promise<void> {
  const bad = (msg = "That code didn't match. Check the code on screen or ask for a new one.") => new AppError("OTP_INVALID", msg);
  if (!input.otpChallengeId || !input.otpCode) throw bad("Enter the 4-digit code first.");
  const ch = await tx.otpChallenge.findUnique({ where: { id: input.otpChallengeId } });
  if (!ch || ch.phone !== input.phone) throw bad();
  if (ch.usedAt) throw bad("That code was already used. Ask for a new one.");
  if (ch.expiresAt.getTime() < Date.now()) throw bad("That code has expired. Ask for a new one.");
  if (ch.attempts >= 5) throw bad("Too many wrong tries. Ask for a new code.");
  if (ch.code !== input.otpCode) {
    // outside the transaction so the failed attempt survives the rollback
    await prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
    throw bad();
  }
  const used = await tx.otpChallenge.updateMany({ where: { id: ch.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw bad("That code was already used. Ask for a new one.");
}

export async function createToken(tx: Tx, input: CreateTokenInput, actor: Actor): Promise<Outcome<{ tokenId: string; label: string }>> {
  if (actor.kind !== "simulator") await consumeOtp(tx, input);

  // serialise numbering per department
  const locked = await tx.$queryRaw<{ id: string; code: string; name: string }[]>`SELECT id, code, name FROM "Department" WHERE id = ${input.departmentId} FOR UPDATE`;
  const dept = locked[0];
  if (!dept) throw new AppError("NOT_FOUND", "That department doesn't exist. Pick one from the list.");

  const date = serviceDateFor();
  const max = await tx.token.aggregate({ where: { departmentId: dept.id, serviceDate: date }, _max: { tokenNumber: true } });
  const tokenNumber = (max._max.tokenNumber ?? 0) + 1;

  const patient = await tx.patient.create({ data: { name: input.name, phone: input.phone, age: input.age ?? null, email: input.email || null } });
  const token = await tx.token.create({
    data: { tokenNumber, serviceDate: date, patientId: patient.id, departmentId: dept.id, priority: input.priority },
  });
  const label = formatToken(dept.code, tokenNumber);
  await audit(tx, actor, "token.created", "Token", token.id, null, { label, status: "WAITING", priority: input.priority });

  const effects: Effect[] = [{ kind: "dept", id: dept.id }, { kind: "admin" }];
  if (actor.kind !== "simulator" && input.email && ALERT_PRIORITIES.includes(input.priority)) {
    effects.push({ kind: "alert", tokenId: token.id, label, priority: input.priority, department: dept.name, patientName: input.name, email: input.email, reason: "check-in" });
  }
  return { result: { tokenId: token.id, label }, effects };
}

// ---------------------------------------------------------------- queue

function canActOnDoctor(actor: Actor, doctorId: string): boolean {
  if (actor.kind === "simulator") return true;
  if (actor.kind !== "staff") return false;
  return actor.user.role === "ADMIN" || (actor.user.role === "DOCTOR" && actor.user.doctorId === doctorId);
}

export async function callNext(tx: Tx, input: CallNextInput, actor: Actor): Promise<Outcome<{ tokenId: string; label: string; room: string }>> {
  requireRole(actor, ["ADMIN", "DOCTOR"]);
  if (!canActOnDoctor(actor, input.doctorId)) throw new AppError("FORBIDDEN", "You can only call patients for your own room.");

  const rows = await tx.$queryRaw<{ id: string; status: string; room: string; departmentId: string }[]>`SELECT id, status::text AS status, room, "departmentId" FROM "Doctor" WHERE id = ${input.doctorId} FOR UPDATE`;
  const doc = rows[0];
  if (!doc) throw new AppError("NOT_FOUND", "We couldn't find that doctor.");
  if (doc.status === "ON_BREAK" || doc.status === "OFFLINE") {
    throw new AppError("CONFLICT", "You're not available right now. Switch to Available to call patients.");
  }
  const busy = await tx.token.findFirst({ where: { doctorId: doc.id, status: { in: ["CALLED", "IN_CONSULT"] } } });
  if (busy) throw new AppError("DOCTOR_BUSY", "Finish the current patient before calling the next one.");

  const picked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Token"
    WHERE "departmentId" = ${doc.departmentId} AND "serviceDate" = ${serviceDateFor()} AND status = 'WAITING'
    ORDER BY priority ASC, "checkedInAt" ASC
    FOR UPDATE SKIP LOCKED LIMIT 1`;
  const next = picked[0];
  if (!next) throw new AppError("QUEUE_EMPTY", "No one is waiting right now.");

  const dept = await tx.department.findUniqueOrThrow({ where: { id: doc.departmentId } });
  const token = await tx.token.update({
    where: { id: next.id },
    data: { status: "CALLED", doctorId: doc.id, calledAt: new Date(), version: { increment: 1 } },
  });
  await tx.doctor.update({ where: { id: doc.id }, data: { status: "WITH_PATIENT", currentTokenId: token.id } });
  const label = formatToken(dept.code, token.tokenNumber);
  await audit(tx, actor, "token.called", "Token", token.id, { status: "WAITING" }, { label, status: "CALLED", room: doc.room });

  return {
    result: { tokenId: token.id, label, room: doc.room },
    effects: [{ kind: "dept", id: dept.id }, { kind: "called", tokenId: token.id }, { kind: "admin" }],
  };
}

const RELEASES: TokenStatus[] = ["COMPLETED", "TRANSFERRED_TO_LAB", "NO_SHOW", "WAITING"];
const NICE: Record<TokenStatus, string> = {
  WAITING: "waiting", CALLED: "called", IN_CONSULT: "in consultation", TRANSFERRED_TO_LAB: "sent to lab",
  COMPLETED: "completed", NO_SHOW: "marked as no-show", CANCELLED: "cancelled",
};

export async function transition(tx: Tx, tokenId: string, to: TokenStatus, actor: Actor): Promise<Outcome<{ tokenId: string; status: TokenStatus; requeued: boolean }>> {
  requireRole(actor, ["ADMIN", "DOCTOR", "RECEPTIONIST"]);
  const token = await tx.token.findUnique({ where: { id: tokenId }, include: { department: true } });
  if (!token) throw new AppError("NOT_FOUND", "We couldn't find that token.");

  if (actor.kind === "staff") {
    const u = actor.user;
    const ownsToken = u.role === "DOCTOR" && token.doctorId !== null && u.doctorId === token.doctorId;
    const deskCancel = to === "CANCELLED" && (u.role === "RECEPTIONIST" || (u.role === "DOCTOR" && u.departmentId === token.departmentId));
    if (u.role !== "ADMIN" && !ownsToken && !deskCancel) {
      throw new AppError("FORBIDDEN", "That patient belongs to another doctor's room.");
    }
  }
  if (!canTransition(token.status, to)) {
    throw new AppError("INVALID_TRANSITION", `This token is already ${NICE[token.status]}, so it can't be ${NICE[to]}. Refresh to see the latest.`);
  }
  if (token.doctorId) await tx.$queryRaw`SELECT id FROM "Doctor" WHERE id = ${token.doctorId} FOR UPDATE`;

  const now = new Date();
  // first miss: back to the end of the line; second miss: removed for good
  const requeue = to === "NO_SHOW" && token.missedCount === 0;
  if (requeue) to = "WAITING";
  const data: Record<string, unknown> = { status: to, version: { increment: 1 } };
  if (requeue) { data.checkedInAt = now; data.missedCount = { increment: 1 }; data.notified1 = false; data.notified2 = false; }
  if (to === "IN_CONSULT") data.startedAt = now;
  if (to === "COMPLETED" || to === "TRANSFERRED_TO_LAB" || to === "NO_SHOW") data.completedAt = now;
  if (to === "WAITING") { data.doctorId = null; data.calledAt = null; }
  const upd = await tx.token.updateMany({ where: { id: token.id, status: token.status, version: token.version }, data });
  if (upd.count !== 1) throw new AppError("CONFLICT", "Someone just updated this token. Refresh to see the latest.");

  if (token.doctorId && RELEASES.includes(to)) {
    await tx.doctor.update({ where: { id: token.doctorId }, data: { status: "AVAILABLE", currentTokenId: null } });
  }
  const label = formatToken(token.department.code, token.tokenNumber);
  await audit(tx, actor, requeue ? "token.requeued" : `token.${to.toLowerCase()}`, "Token", token.id, { status: token.status }, { label, status: to });
  return { result: { tokenId: token.id, status: to, requeued: requeue }, effects: [{ kind: "dept", id: token.departmentId }, { kind: "admin" }] };
}

export async function retriage(tx: Tx, input: RetriageInput, actor: Actor): Promise<Outcome<{ tokenId: string; priority: Priority }>> {
  requireRole(actor, ["ADMIN", "DOCTOR", "RECEPTIONIST"]);
  const token = await tx.token.findUnique({ where: { id: input.tokenId }, include: { department: true, patient: true } });
  if (!token) throw new AppError("NOT_FOUND", "We couldn't find that token.");
  if (actor.kind === "staff" && actor.user.role === "DOCTOR" && actor.user.departmentId !== token.departmentId) {
    throw new AppError("FORBIDDEN", "You can only change urgency for your own department.");
  }
  if (token.status !== "WAITING") throw new AppError("INVALID_TRANSITION", "Only patients who are still waiting can be re-triaged.");
  const upd = await tx.token.updateMany({ where: { id: token.id, status: "WAITING" }, data: { priority: input.priority, version: { increment: 1 } } });
  if (upd.count !== 1) throw new AppError("CONFLICT", "Someone just updated this token. Refresh to see the latest.");
  const label = formatToken(token.department.code, token.tokenNumber);
  await audit(tx, actor, "token.retriaged", "Token", token.id, { priority: token.priority }, { label, priority: input.priority });

  const effects: Effect[] = [{ kind: "dept", id: token.departmentId }, { kind: "admin" }];
  if (input.priority !== token.priority && actor.kind !== "simulator" && token.patient.email && ALERT_PRIORITIES.includes(input.priority)) {
    effects.push({ kind: "alert", tokenId: token.id, label, priority: input.priority, department: token.department.name, patientName: token.patient.name, email: token.patient.email, reason: "re-triage" });
  }
  return { result: { tokenId: token.id, priority: input.priority }, effects };
}

// ---------------------------------------------------------------- beds

export async function updateBedStatus(tx: Tx, input: BedUpdateInput, actor: Actor): Promise<Outcome<{ bedId: string; version: number }>> {
  requireRole(actor, ["ADMIN", "RECEPTIONIST"]);
  const bed = await tx.bed.findUnique({ where: { id: input.bedId }, include: { ward: true } });
  if (!bed) throw new AppError("NOT_FOUND", "We couldn't find that bed.");
  const keepName = input.status === "OCCUPIED" || input.status === "RESERVED";
  const upd = await tx.bed.updateMany({
    where: { id: bed.id, version: input.expectedVersion },
    data: {
      status: input.status,
      patientName: keepName ? (input.patientName ?? bed.patientName) : null,
      version: { increment: 1 }, updatedAt: new Date(), updatedBy: actorName(actor),
    },
  });
  if (upd.count !== 1) {
    throw new AppError("CONFLICT", `Bed ${bed.bedNumber} was changed by someone else a moment ago. Showing the latest status.`);
  }
  await audit(tx, actor, "bed.status", "Bed", bed.id, { status: bed.status }, { bed: bed.bedNumber, ward: bed.ward.name, status: input.status });
  return { result: { bedId: bed.id, version: bed.version + 1 }, effects: [{ kind: "beds", bedId: bed.id }, { kind: "admin" }] };
}

export async function verifyWard(tx: Tx, input: WardVerifyInput, actor: Actor): Promise<Outcome<{ wardId: string }>> {
  requireRole(actor, ["ADMIN", "RECEPTIONIST"]);
  const ward = await tx.ward.findUnique({ where: { id: input.wardId } });
  if (!ward) throw new AppError("NOT_FOUND", "We couldn't find that ward.");
  await tx.ward.update({ where: { id: ward.id }, data: { verifiedAt: new Date(), verifiedBy: actorName(actor) } });
  await audit(tx, actor, "ward.verified", "Ward", ward.id, null, { ward: ward.name });
  return { result: { wardId: ward.id }, effects: [{ kind: "beds" }, { kind: "admin" }] };
}

// ---------------------------------------------------------------- doctors

export async function updateDoctorStatus(tx: Tx, input: DoctorStatusInput, actor: Actor): Promise<Outcome<{ doctorId: string; status: string }>> {
  requireRole(actor, ["ADMIN", "DOCTOR"]);
  if (!canActOnDoctor(actor, input.doctorId)) throw new AppError("FORBIDDEN", "You can only change your own status.");
  if (input.status === "WITH_PATIENT") throw new AppError("VALIDATION", "\"With patient\" is set automatically when you call a patient.");
  const rows = await tx.$queryRaw<{ id: string; status: string; departmentId: string; name: string }[]>`SELECT id, status::text AS status, "departmentId", name FROM "Doctor" WHERE id = ${input.doctorId} FOR UPDATE`;
  const doc = rows[0];
  if (!doc) throw new AppError("NOT_FOUND", "We couldn't find that doctor.");

  const busy = await tx.token.findFirst({ where: { doctorId: doc.id, status: { in: ["CALLED", "IN_CONSULT"] } } });
  if (busy && input.status !== "AVAILABLE") throw new AppError("DOCTOR_BUSY", "Finish the current patient before going on break.");
  if (busy) return { result: { doctorId: doc.id, status: doc.status }, effects: [] };

  await tx.doctor.update({ where: { id: doc.id }, data: { status: input.status, currentTokenId: null } });
  await audit(tx, actor, "doctor.status", "Doctor", doc.id, { status: doc.status }, { doctor: doc.name, status: input.status });
  return { result: { doctorId: doc.id, status: input.status }, effects: [{ kind: "dept", id: doc.departmentId }, { kind: "admin" }] };
}
