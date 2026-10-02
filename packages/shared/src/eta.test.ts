import { describe, expect, it } from "vitest";
import {
  BED_CYCLE, canTransition, compareQueue, computeEtas, formatToken, rollingAverage, vacancyBand,
  type EtaToken,
} from "./index";

const now = new Date("2026-01-01T10:00:00Z");
const at = (min: number) => new Date(now.getTime() + min * 60000);
const w = (id: string, minAgo: number, priority: EtaToken["priority"] = "NORMAL"): EtaToken => ({
  id, priority, status: "WAITING", checkedInAt: at(-minAgo),
});

describe("queue order", () => {
  it("sorts by priority then check-in", () => {
    const list = [w("a", 10), w("b", 5, "URGENT"), w("c", 1, "EMERGENCY"), w("d", 20)];
    expect(list.sort(compareQueue).map((t) => t.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("computeEtas", () => {
  it("one doctor: ahead x avg minus elapsed", () => {
    const tokens: EtaToken[] = [
      { id: "x", priority: "NORMAL", status: "IN_CONSULT", checkedInAt: at(-30), doctorId: "d1", startedAt: at(-3) },
      w("a", 10), w("b", 5), w("c", 2),
    ];
    const r = computeEtas({ tokens, activeDoctorIds: ["d1"], avgConsultMinutes: 8, now });
    expect(r.map((e) => e.etaMinutes)).toEqual([5, 13, 21]);
    expect(r.map((e) => e.ahead)).toEqual([0, 1, 2]);
    expect(r.map((e) => e.position)).toEqual([1, 2, 3]);
  });
  it("two doctors share the line", () => {
    const r = computeEtas({ tokens: [w("a", 9), w("b", 8), w("c", 7), w("d", 6)], activeDoctorIds: ["d1", "d2"], avgConsultMinutes: 10, now });
    expect(r.map((e) => e.etaMinutes)).toEqual([0, 0, 10, 10]);
  });
  it("CALLED patient still costs a full consult", () => {
    const tokens: EtaToken[] = [
      { id: "x", priority: "NORMAL", status: "CALLED", checkedInAt: at(-30), doctorId: "d1", calledAt: at(-1) },
      w("a", 5),
    ];
    expect(computeEtas({ tokens, activeDoctorIds: ["d1"], avgConsultMinutes: 8, now })[0]!.etaMinutes).toBe(8);
  });
  it("null ETA with no doctors, ahead counts waiting only", () => {
    const r = computeEtas({ tokens: [w("a", 3), w("b", 2)], activeDoctorIds: [], avgConsultMinutes: 8, now });
    expect(r.every((e) => e.etaMinutes === null && e.estimatedCallTime === null)).toBe(true);
    expect(r[1]!.ahead).toBe(1);
  });
  it("never negative when a consult overruns", () => {
    const tokens: EtaToken[] = [
      { id: "x", priority: "NORMAL", status: "IN_CONSULT", checkedInAt: at(-90), doctorId: "d1", startedAt: at(-40) },
      w("a", 5),
    ];
    const r = computeEtas({ tokens, activeDoctorIds: ["d1"], avgConsultMinutes: 8, now });
    expect(r[0]!.etaMinutes).toBe(1);
  });
});

describe("rollingAverage", () => {
  it("averages the latest five", () => expect(rollingAverage([6, 8, 10, 12, 14, 100], 8)).toBe(10));
  it("falls back", () => expect(rollingAverage([], 9)).toBe(9));
  it("clamps to 2..60", () => {
    expect(rollingAverage([1.2], 8)).toBe(2);
    expect(rollingAverage([200], 8)).toBe(60);
  });
});

describe("domain rules", () => {
  it("state machine", () => {
    expect(canTransition("WAITING", "CALLED")).toBe(true);
    expect(canTransition("CALLED", "WAITING")).toBe(true);
    expect(canTransition("IN_CONSULT", "TRANSFERRED_TO_LAB")).toBe(true);
    expect(canTransition("COMPLETED", "IN_CONSULT")).toBe(false);
    expect(canTransition("WAITING", "IN_CONSULT")).toBe(false);
  });
  it("bed cycle", () => expect(BED_CYCLE.RESERVED).toBe("VACANT"));
  it("vacancy bands", () => {
    expect(vacancyBand(3, 10)).toBe("ok");
    expect(vacancyBand(2, 10)).toBe("low");
    expect(vacancyBand(1, 10)).toBe("low");
    expect(vacancyBand(0, 10)).toBe("critical");
    expect(vacancyBand(0, 0)).toBe("critical");
  });
  it("token label", () => expect(formatToken("GM", 12)).toBe("GM-012"));
});
