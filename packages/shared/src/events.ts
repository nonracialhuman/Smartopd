export const rooms = {
  dept: (id: string) => `dept:${id}`,
  token: (id: string) => `token:${id}`,
  staffDept: (id: string) => `staff:dept:${id}`,
  publicBeds: "public:beds",
  admin: "admin:dashboard",
} as const;

export const CLIENT_JOIN_EVENTS = ["join:department", "join:token", "join:public-beds", "join:staff-department", "join:admin", "leave"] as const;

export const COMMAND_EVENTS = [
  "token:create", "queue:call-next", "queue:start-consult", "queue:mark-completed", "queue:transfer-lab",
  "queue:no-show", "queue:retriage", "bed:update-status", "ward:verify", "doctor:update-status", "sim:set",
] as const;
export type CommandName = (typeof COMMAND_EVENTS)[number];

export const SERVER_EVENTS = [
  "queue:updated", "staff:queue-updated", "token:updated", "token:called", "bed:updated", "bed:aggregate", "admin:overview", "sim:state",
] as const;

export type ErrorCode =
  | "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_TRANSITION"
  | "CONFLICT" | "QUEUE_EMPTY" | "DOCTOR_BUSY" | "OTP_INVALID" | "INTERNAL";

export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

export const HTTP_STATUS_FOR_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID_TRANSITION: 409,
  CONFLICT: 409, QUEUE_EMPTY: 409, DOCTOR_BUSY: 409, OTP_INVALID: 400, INTERNAL: 500,
};
