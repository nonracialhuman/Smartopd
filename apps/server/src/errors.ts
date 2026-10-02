import type { ErrorCode, SessionUser } from "@smartopd/shared";
import type { StaffRole } from "@smartopd/shared";

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export type Actor =
  | { kind: "staff"; user: SessionUser }
  | { kind: "patient" }
  | { kind: "simulator" };

export function actorName(actor: Actor): string {
  return actor.kind === "staff" ? actor.user.name : actor.kind;
}

export function requireRole(actor: Actor, roles: StaffRole[]): void {
  if (actor.kind === "simulator") return;
  if (actor.kind !== "staff") throw new AppError("UNAUTHENTICATED", "Please sign in as staff to do that.");
  if (!roles.includes(actor.user.role)) throw new AppError("FORBIDDEN", "Your role can't do that. Ask an admin if you need access.");
}
