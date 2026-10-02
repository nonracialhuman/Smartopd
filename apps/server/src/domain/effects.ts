import type { Priority } from "@smartopd/shared";

/** Broadcasts and side effects, applied only after the transaction commits. */
export type Effect =
  | { kind: "dept"; id: string }
  | { kind: "called"; tokenId: string }
  | { kind: "beds"; bedId?: string }
  | { kind: "admin" }
  | { kind: "alert"; tokenId: string; label: string; priority: Priority; department: string; patientName: string; email: string; reason: "check-in" | "re-triage" };

export interface Outcome<T> {
  result: T;
  effects: Effect[];
}

export function effectKey(e: Effect): string {
  switch (e.kind) {
    case "dept": return `dept:${e.id}`;
    case "called": return `called:${e.tokenId}`;
    case "beds": return `beds:${e.bedId ?? "*"}`;
    case "admin": return "admin";
    case "alert": return `alert:${e.tokenId}:${e.priority}`;
  }
}
