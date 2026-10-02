import { SignJWT, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";
import type { SessionUser, StaffRole } from "@smartopd/shared";
import { config } from "../config";
import { AppError } from "../errors";

const ISSUER = "smartopd";
export const COOKIE = "sopd_session";

const claims = (u: SessionUser) => ({ name: u.name, email: u.email, role: u.role, departmentId: u.departmentId, doctorId: u.doctorId });

export async function signToken(u: SessionUser, audience: "session" | "socket", ttl: string): Promise<string> {
  return new SignJWT(claims(u))
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id).setIssuer(ISSUER).setAudience(audience).setIssuedAt().setExpirationTime(ttl)
    .sign(config.secret);
}

export async function verifyToken(token: string | undefined, audience: "session" | "socket"): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config.secret, { issuer: ISSUER, audience });
    return {
      id: String(payload.sub), name: String(payload.name), email: String(payload.email), role: payload.role as StaffRole,
      departmentId: (payload.departmentId as string | null) ?? null, doctorId: (payload.doctorId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export const sessionUser = (req: Request) => verifyToken(req.cookies?.[COOKIE], "session");

export function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: config.isProd, path: "/", maxAge: 12 * 3600 * 1000 };
}

declare module "express-serve-static-core" {
  interface Request { user?: SessionUser }
}

export function requireStaff(roles?: StaffRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = await sessionUser(req);
      if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
      if (roles && !roles.includes(user.role)) throw new AppError("FORBIDDEN", "Your role can't open that. Ask an admin if you need access.");
      req.user = user;
      next();
    } catch (e) { next(e); }
  };
}
