export const PRIORITIES = ["EMERGENCY", "URGENT", "NORMAL"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TOKEN_STATUSES = ["WAITING", "CALLED", "IN_CONSULT", "TRANSFERRED_TO_LAB", "COMPLETED", "NO_SHOW", "CANCELLED"] as const;
export type TokenStatus = (typeof TOKEN_STATUSES)[number];

export const DOCTOR_STATUSES = ["AVAILABLE", "WITH_PATIENT", "ON_BREAK", "OFFLINE"] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

export const BED_TYPES = ["GENERAL", "ICU", "OXYGEN"] as const;
export type BedType = (typeof BED_TYPES)[number];

export const BED_STATUSES = ["VACANT", "OCCUPIED", "CLEANING", "RESERVED"] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

export const STAFF_ROLES = ["ADMIN", "DOCTOR", "RECEPTIONIST"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const TOKEN_TRANSITIONS: Record<TokenStatus, readonly TokenStatus[]> = {
  WAITING: ["CALLED", "CANCELLED"],
  CALLED: ["IN_CONSULT", "NO_SHOW", "WAITING"],
  IN_CONSULT: ["COMPLETED", "TRANSFERRED_TO_LAB"],
  TRANSFERRED_TO_LAB: [],
  COMPLETED: [],
  NO_SHOW: [],
  CANCELLED: [],
};

export function canTransition(from: TokenStatus, to: TokenStatus): boolean {
  return TOKEN_TRANSITIONS[from].includes(to);
}

export const BED_CYCLE: Record<BedStatus, BedStatus> = {
  VACANT: "OCCUPIED",
  OCCUPIED: "CLEANING",
  CLEANING: "RESERVED",
  RESERVED: "VACANT",
};

export const STALE_AFTER_MINUTES = 30;

/** Lower rank is served first. */
export const PRIORITY_RANK: Record<Priority, number> = { EMERGENCY: 0, URGENT: 1, NORMAL: 2 };

/** Priority 1 and 2: these trigger a staff alert email. */
export const ALERT_PRIORITIES: readonly Priority[] = ["EMERGENCY", "URGENT"];

export function formatToken(code: string, n: number): string {
  return `${code}-${String(n).padStart(3, "0")}`;
}

export type VacancyBand = "ok" | "low" | "critical";

export function vacancyBand(vacant: number, total: number): VacancyBand {
  if (total <= 0) return "critical";
  const ratio = vacant / total;
  if (ratio >= 0.3) return "ok";
  if (ratio >= 0.1) return "low";
  return "critical";
}

export const TERMINAL_STATUSES: readonly TokenStatus[] = ["TRANSFERRED_TO_LAB", "COMPLETED", "NO_SHOW", "CANCELLED"];
export const OPEN_STATUSES: readonly TokenStatus[] = ["WAITING", "CALLED", "IN_CONSULT"];
