import { Router, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { ZodError } from "zod";
import { COMMAND_EVENTS, HTTP_STATUS_FOR_CODE, loginSchema, otpRequestSchema, type SessionUser } from "@smartopd/shared";
import { prisma } from "../db";
import { AppError, type Actor } from "../errors";
import { logger } from "../logger";
import { execute } from "../commands/bus";
import {
  lastSeq, listDepartments, loadAdminBeds, loadAdminOverview, loadBedBoard, loadDepartmentState, loadTokenView, toPublicQueue, toStaffQueue,
} from "../domain/projections";
import { COOKIE, cookieOptions, requireStaff, sessionUser, signToken } from "./auth";

export const api = Router();

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

api.get("/health", (_req, res) => res.json({ ok: true, data: { status: "up", time: new Date().toISOString() } }));

api.get("/departments", wrap(async (_req, res) => {
  res.set("Cache-Control", "public, max-age=30");
  res.json({ ok: true, data: await listDepartments() });
}));

api.get("/queue/:deptId", wrap(async (req, res) => {
  const seq = await lastSeq();
  res.json({ ok: true, data: toPublicQueue(await loadDepartmentState(req.params.deptId!), seq) });
}));

api.get("/tokens/:id", wrap(async (req, res) => {
  res.json({ ok: true, data: await loadTokenView(req.params.id!, await lastSeq()) });
}));

api.get("/beds/summary", wrap(async (_req, res) => res.json({ ok: true, data: await loadBedBoard(await lastSeq()) })));

// mock OTP: the code is returned so the demo UI can show it; nothing is sent by SMS
api.post("/otp/request", wrap(async (req, res) => {
  const { phone } = otpRequestSchema.parse(req.body);
  const recent = await prisma.otpChallenge.count({ where: { phone, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (recent >= 5) {
    return void res.status(429).json({ ok: false, error: { code: "CONFLICT", message: "Too many codes requested for this number. Please wait a few minutes and try again." } });
  }
  const code = String(randomInt(0, 10000)).padStart(4, "0");
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const ch = await prisma.otpChallenge.create({ data: { phone, code, expiresAt } });
  res.json({ ok: true, data: { challengeId: ch.id, demoCode: code, expiresAt: expiresAt.toISOString() } });
}));

// ---- staff reads
api.get("/staff/queue/:deptId", requireStaff(["ADMIN", "DOCTOR", "RECEPTIONIST"]), wrap(async (req, res) => {
  const u = req.user!;
  if (u.role === "DOCTOR" && u.departmentId !== req.params.deptId) throw new AppError("FORBIDDEN", "That's another department's queue.");
  res.json({ ok: true, data: toStaffQueue(await loadDepartmentState(req.params.deptId!), await lastSeq()) });
}));
api.get("/admin/beds", requireStaff(["ADMIN", "RECEPTIONIST"]), wrap(async (_req, res) => res.json({ ok: true, data: await loadAdminBeds() })));
api.get("/admin/overview", requireStaff(["ADMIN", "RECEPTIONIST"]), wrap(async (_req, res) => res.json({ ok: true, data: await loadAdminOverview(await lastSeq()) })));
api.get("/admin/audit", requireStaff(["ADMIN", "RECEPTIONIST"]), wrap(async (_req, res) => {
  const rows = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 30 });
  res.json({ ok: true, data: rows.map((r) => ({ ...r, at: r.at.toISOString() })) });
}));

// ---- auth
const toSession = (s: { id: string; email: string; name: string; role: SessionUser["role"]; departmentId: string | null; doctorId: string | null }): SessionUser => ({
  id: s.id, email: s.email, name: s.name, role: s.role, departmentId: s.departmentId, doctorId: s.doctorId,
});

api.post("/auth/login", wrap(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const row = await prisma.staffUser.findUnique({ where: { email: email.toLowerCase() } });
  const ok = row ? await bcrypt.compare(password, row.passwordHash) : false;
  if (!row || !ok) throw new AppError("UNAUTHENTICATED", "That email and password don't match. Check them or tap a demo account.");
  const user = toSession(row);
  res.cookie(COOKIE, await signToken(user, "session", "12h"), cookieOptions());
  res.json({ ok: true, data: user });
}));
api.post("/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true, data: {} });
});
api.get("/auth/me", wrap(async (req, res) => {
  const user = await sessionUser(req);
  if (!user) throw new AppError("UNAUTHENTICATED", "You're not signed in.");
  res.json({ ok: true, data: user });
}));
// staff only: anonymous visitors get no ticket (200 with null, so public pages don't log a failed request)
api.get("/auth/socket-ticket", wrap(async (req, res) => {
  const user = await sessionUser(req);
  res.json({ ok: true, data: { ticket: user ? await signToken(user, "socket", "120s") : null } });
}));

// ---- commands (REST fallback to the socket transport)
api.post("/commands/:name", wrap(async (req, res) => {
  const name = req.params.name!;
  if (!(COMMAND_EVENTS as readonly string[]).includes(name)) throw new AppError("NOT_FOUND", `Unknown command "${name}".`);
  const user = await sessionUser(req);
  const actor: Actor = user ? { kind: "staff", user } : { kind: "patient" };
  const ack = await execute(name, req.body, actor);
  res.status(ack.ok ? 200 : HTTP_STATUS_FOR_CODE[ack.error.code]).json(ack);
}));

// ---- error envelope
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return void res.status(400).json({ ok: false, error: { code: "VALIDATION", message: err.issues[0]?.message ?? "Some details look wrong." } });
  }
  if (err instanceof AppError) {
    return void res.status(HTTP_STATUS_FOR_CODE[err.code]).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  logger.error({ err }, "request failed");
  res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again in a moment." } });
}
