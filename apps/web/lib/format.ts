/** minutes between an ISO time and now; 0 when the clock isn't ready (now === 0). */
export function minutesSince(iso: string | null | undefined, now: number): number {
  if (!iso || !now) return 0;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
}

export function minutesUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso || !now) return null;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 60000));
}

export function clock(now: number, tz = "Asia/Kolkata"): string {
  if (!now) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(now);
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  if (!now) return "";
  const m = minutesSince(iso, now);
  return m < 1 ? "just now" : `${m} min ago`;
}

export const PRIORITY_LABEL = { EMERGENCY: "Emergency", URGENT: "Urgent", NORMAL: "Routine" } as const;
