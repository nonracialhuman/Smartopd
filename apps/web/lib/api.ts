import type { Ack } from "@smartopd/shared";

/** Same-origin REST (proxied to the realtime server) so the session cookie stays first-party. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<Ack<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      credentials: "include",
      ...init,
      headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
    return (await res.json()) as Ack<T>;
  } catch {
    return { ok: false, error: { code: "INTERNAL", message: "We couldn't reach the server. Check your connection and try again." } };
  }
}

import type { DepartmentDTO } from "@smartopd/shared";

let deptCache: Promise<Ack<DepartmentDTO[]>> | null = null;
/** Departments rarely change: one request per page load, shared by every component; a failure is not cached. */
export function getDepartments(): Promise<Ack<DepartmentDTO[]>> {
  deptCache ??= api<DepartmentDTO[]>("/departments").then((r) => { if (!r.ok) deptCache = null; return r; });
  return deptCache;
}

export const randomId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
