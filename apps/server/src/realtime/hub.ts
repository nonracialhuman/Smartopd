import type { Server } from "socket.io";
import { rooms, type TokenCalledEvent, type BedUpdatedEvent } from "@smartopd/shared";
import { prisma } from "../db";
import { logger } from "../logger";
import { effectKey, type Effect } from "../domain/effects";
import {
  loadAdminOverview, loadBedBoard, loadDepartmentState, nextSeq, toBedDTO, toPublicQueue, toStaffQueue, toTokenView,
} from "../domain/projections";
import { sendPriorityAlert } from "../notify/alerts";
import { notifyQueuePositions } from "../notify/position-alerts";
import { connectedDoctors } from "../sim/state";

let io: Server | null = null;
export const setIo = (s: Server) => { io = s; };
export const getIo = () => io;
export { connectedDoctors };

const listeners = (room: string) => io?.sockets.adapter.rooms.get(room)?.size ?? 0;

/** Each push is a full projection stamped with a fresh seq, taken before the read so later seq = fresher data. */
export async function publishDepartment(deptId: string): Promise<void> {
  const seq = io ? await nextSeq() : 0;
  const state = await loadDepartmentState(deptId);
  // emails for patients who just reached 2nd / 1st; independent of who is connected
  void notifyQueuePositions(state).catch((err) => logger.error({ err }, "position alerts failed"));
  if (!io) return;
  io.to(rooms.dept(deptId)).emit("queue:updated", toPublicQueue(state, seq));
  io.to(rooms.staffDept(deptId)).emit("staff:queue-updated", toStaffQueue(state, seq));
  for (const t of [...state.open, ...state.recent]) {
    if (listeners(rooms.token(t.id)) > 0) {
      const view = toTokenView(state, t.id, seq);
      if (view) io.to(rooms.token(t.id)).emit("token:updated", view);
    }
  }
}

export async function publishTokenCalled(tokenId: string): Promise<void> {
  if (!io) return;
  const t = await prisma.token.findUnique({ where: { id: tokenId }, include: { doctor: true, department: true } });
  if (!t || !t.doctor) return;
  const seq = await nextSeq();
  const ev: TokenCalledEvent = {
    seq, tokenId, label: `${t.department.code}-${String(t.tokenNumber).padStart(3, "0")}`, room: t.doctor.room, doctorName: t.doctor.name,
  };
  io.to(rooms.token(tokenId)).emit("token:called", ev);
  io.to(rooms.dept(t.departmentId)).emit("token:called", ev);
}

export async function publishBeds(bedId?: string): Promise<void> {
  if (!io) return;
  const seq = await nextSeq();
  io.to(rooms.publicBeds).emit("bed:aggregate", await loadBedBoard(seq));
  if (bedId) {
    const bed = await prisma.bed.findUnique({ where: { id: bedId } });
    if (bed) {
      // full detail (patient names) goes to the admin room only
      const ev: BedUpdatedEvent = { seq, bed: toBedDTO(bed) };
      io.to(rooms.admin).emit("bed:updated", ev);
    }
  }
}

export async function publishAdmin(): Promise<void> {
  if (!io || listeners(rooms.admin) === 0) return;
  io.to(rooms.admin).emit("admin:overview", await loadAdminOverview(await nextSeq()));
}

export async function publishAllDepartments(): Promise<void> {
  const depts = await prisma.department.findMany({ select: { id: true } });
  for (const d of depts) await publishDepartment(d.id);
}

async function apply(e: Effect): Promise<void> {
  switch (e.kind) {
    case "dept": return publishDepartment(e.id);
    case "called": return publishTokenCalled(e.tokenId);
    case "beds": return publishBeds(e.bedId);
    case "admin": return publishAdmin();
    case "alert": return sendPriorityAlert(e);
  }
}

/** Never throws: a failed broadcast must not undo a committed write. */
export async function applyEffects(effects: Effect[]): Promise<void> {
  const unique = [...new Map(effects.map((e) => [effectKey(e), e])).values()];
  // department + called first so the patient's screen flips before secondary fan-out
  unique.sort((a, b) => Number(b.kind === "called") - Number(a.kind === "called"));
  await Promise.all(unique.map((e) => apply(e).catch((err) => logger.error({ err, effect: e }, "effect failed"))));
}
