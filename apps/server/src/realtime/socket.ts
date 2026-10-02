import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { COMMAND_EVENTS, rooms, type Ack, type SessionUser } from "@smartopd/shared";
import { config } from "../config";
import { execute } from "../commands/bus";
import { Actor, AppError } from "../errors";
import { prisma } from "../db";
import {
  lastSeq, loadAdminOverview, loadBedBoard, loadDepartmentState, loadTokenView, toPublicQueue, toStaffQueue,
} from "../domain/projections";
import { verifyToken } from "../http/auth";
import { logger } from "../logger";
import { connectedDoctors, setIo } from "./hub";
import { simulatorState } from "../sim/state";

type Handler = (payload: any, user: SessionUser | null) => Promise<{ room: string; snapshot: unknown }>;

const needStaff = (user: SessionUser | null): SessionUser => {
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in as staff to do that.");
  return user;
};

const joins: Record<string, Handler> = {
  "join:department": async (p) => {
    const id = String(p?.departmentId ?? "");
    const snapshot = toPublicQueue(await loadDepartmentState(id), await lastSeq());
    return { room: rooms.dept(id), snapshot };
  },
  "join:token": async (p) => {
    const id = String(p?.tokenId ?? "");
    return { room: rooms.token(id), snapshot: await loadTokenView(id, await lastSeq()) };
  },
  "join:public-beds": async () => ({ room: rooms.publicBeds, snapshot: await loadBedBoard(await lastSeq()) }),
  "join:staff-department": async (p, user) => {
    const u = needStaff(user);
    const id = String(p?.departmentId ?? "");
    if (u.role === "DOCTOR" && u.departmentId !== id) throw new AppError("FORBIDDEN", "That's another department's queue.");
    return { room: rooms.staffDept(id), snapshot: toStaffQueue(await loadDepartmentState(id), await lastSeq()) };
  },
  "join:admin": async (_p, user) => {
    const u = needStaff(user);
    if (u.role !== "ADMIN" && u.role !== "RECEPTIONIST") throw new AppError("FORBIDDEN", "Your role can't open the admin console.");
    return { room: rooms.admin, snapshot: await loadAdminOverview(await lastSeq()) };
  },
};

export function attachSocketServer(http: HttpServer): Server {
  const io = new Server(http, {
    cors: { origin: config.webOrigins, credentials: true },
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });
  setIo(io);

  io.use(async (socket, next) => {
    const ticket = socket.handshake.auth?.token as string | undefined;
    socket.data.user = ticket ? await verifyToken(ticket, "socket") : null;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user as SessionUser | null;
    if (user?.doctorId) connectedDoctors.set(user.doctorId, (connectedDoctors.get(user.doctorId) ?? 0) + 1);

    const reply = <T>(ack: unknown, value: Ack<T>) => { if (typeof ack === "function") (ack as (a: Ack<T>) => void)(value); };

    for (const [event, handler] of Object.entries(joins)) {
      socket.on(event, async (payload: unknown, ack: unknown) => {
        try {
          const { room, snapshot } = await handler(payload, user);
          await socket.join(room);
          reply(ack, { ok: true, data: snapshot });
          if (event === "join:admin") socket.emit("sim:state", { enabled: simulatorState.enabled });
        } catch (e) {
          if (e instanceof AppError) return reply(ack, { ok: false, error: { code: e.code, message: e.message } });
          logger.warn({ err: e, event }, "join failed");
          reply(ack, { ok: false, error: { code: "NOT_FOUND", message: "We couldn't find that. Check the link and try again." } });
        }
      });
    }

    socket.on("leave", (payload: { room?: string }, ack: unknown) => {
      if (payload?.room) void socket.leave(payload.room);
      reply(ack, { ok: true, data: {} });
    });

    for (const name of COMMAND_EVENTS) {
      socket.on(name, async (payload: unknown, ack: unknown) => {
        const actor: Actor = user ? { kind: "staff", user } : { kind: "patient" };
        reply(ack, (await execute(name, payload, actor)) as Ack<unknown>);
      });
    }

    socket.on("disconnect", () => {
      if (!user?.doctorId) return;
      const n = (connectedDoctors.get(user.doctorId) ?? 1) - 1;
      if (n <= 0) connectedDoctors.delete(user.doctorId);
      else connectedDoctors.set(user.doctorId, n);
    });
  });

  return io;
}

export { prisma };
