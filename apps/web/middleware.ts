import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "");

const RULES: { prefix: string; roles: string[] }[] = [
  { prefix: "/doctor", roles: ["DOCTOR", "ADMIN"] },
  { prefix: "/admin", roles: ["ADMIN", "RECEPTIONIST"] },
];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const rule = RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!rule) return NextResponse.next();

  let role: string | null = null;
  const cookie = req.cookies.get("sopd_session")?.value;
  if (cookie) {
    try {
      const { payload } = await jwtVerify(cookie, secret, { issuer: "smartopd", audience: "session" });
      role = String(payload.role);
    } catch { /* expired or invalid */ }
  }
  if (role && rule.roles.includes(role)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}${role ? "&denied=1" : ""}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/doctor/:path*", "/admin/:path*"] };
