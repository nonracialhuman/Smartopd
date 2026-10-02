// Demo traffic, clearly labelled "simulated for hackathon demonstration". Uses the same domain services as real staff.
import { BED_CYCLE, type BedStatus, type Priority } from "@smartopd/shared";
import { prisma, serviceDateFor } from "../db";
import { logger } from "../logger";
import { runDirect } from "../commands/run";
import { callNext, createToken, transition, updateBedStatus } from "../domain/services";
import { connectedDoctors, simulatorState } from "./state";

const SIM = { kind: "simulator" } as const;
const FIRST = ["Aarav", "Vihaan", "Ananya", "Diya", "Rohan", "Isha", "Karthik", "Meera", "Imran", "Zoya", "Gurpreet", "Lakshmi", "Arjun", "Sneha", "Faisal", "Pooja", "Nikhil", "Divya", "Harish", "Tara"];
const LAST = ["Sharma", "Iyer", "Khan", "Patil", "Nair", "Singh", "Reddy", "Das", "Joshi", "Kapoor", "Menon", "Gupta", "Mehta", "Banerjee", "Shetty"];
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;
const between = (lo: number, hi: number) => (lo + Math.random() * (hi - lo)) * 1000;

/** Deterministic 0.7–1.3 spread per token so a consult's length doesn't change between ticks. */
function spread(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 0.7 + (h % 1000) / 1000 * 0.6;
}

const timers: ReturnType<typeof setTimeout>[] = [];

function loop(fn: () => Promise<void>, lo: number, hi: number) {
  const tick = async () => {
    if (!simulatorState.enabled) return;
    try { await fn(); } catch (e) { logger.debug({ err: e }, "sim step skipped"); }
    if (simulatorState.enabled) timers.push(setTimeout(tick, between(lo, hi)));
  };
  timers.push(setTimeout(tick, between(lo, hi)));
}

async function checkIn() {
  const depts = await prisma.department.findMany();
  const dept = pick(depts);
  const r = Math.random();
  const priority: Priority = r < 0.05 ? "EMERGENCY" : r < 0.2 ? "URGENT" : "NORMAL";
  await runDirect((tx) =>
    createToken(tx, {
      name: `${pick(FIRST)} ${pick(LAST)}`, phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      age: 6 + Math.floor(Math.random() * 70), departmentId: dept.id, priority,
    }, SIM),
  );
}

async function bedChurn() {
  const beds = await prisma.bed.findMany();
  const bed = pick(beds);
  const next: BedStatus = bed.status === "VACANT" ? (Math.random() < 0.75 ? "OCCUPIED" : "RESERVED") : bed.status === "RESERVED" ? "OCCUPIED" : BED_CYCLE[bed.status];
  await runDirect((tx) =>
    updateBedStatus(tx, { bedId: bed.id, status: next, expectedVersion: bed.version, patientName: next === "OCCUPIED" || next === "RESERVED" ? `${pick(FIRST)} ${pick(LAST)}` : undefined }, SIM),
  );
}

async function doctorStep() {
  const doctors = await prisma.doctor.findMany({ where: { status: { in: ["AVAILABLE", "WITH_PATIENT"] } }, include: { department: true } });
  for (const doc of doctors) {
    if (connectedDoctors.has(doc.id)) continue; // a real doctor is signed in
    try {
      const cur = await prisma.token.findFirst({ where: { doctorId: doc.id, status: { in: ["CALLED", "IN_CONSULT"] } } });
      const now = Date.now();
      if (cur?.status === "CALLED") {
        if (now - (cur.calledAt?.getTime() ?? now) > 20_000) await runDirect((tx) => transition(tx, cur.id, "IN_CONSULT", SIM));
      } else if (cur?.status === "IN_CONSULT") {
        const lengthMs = doc.department.avgConsultMinutes * 60_000 * spread(cur.id);
        if (now - (cur.startedAt?.getTime() ?? now) > lengthMs) {
          await runDirect((tx) => transition(tx, cur.id, Math.random() < 0.2 ? "TRANSFERRED_TO_LAB" : "COMPLETED", SIM));
        }
      } else {
        const waiting = await prisma.token.count({ where: { departmentId: doc.departmentId, serviceDate: serviceDateFor(), status: "WAITING" } });
        if (waiting > 0) await runDirect((tx) => callNext(tx, { doctorId: doc.id }, SIM));
      }
    } catch (e) {
      logger.debug({ err: e, doctor: doc.name }, "sim doctor step skipped");
    }
  }
}

export function setSimulator(enabled: boolean): void {
  if (enabled === simulatorState.enabled) return;
  simulatorState.enabled = enabled;
  timers.splice(0).forEach(clearTimeout);
  if (!enabled) { logger.info("simulator off"); return; }
  logger.info("simulator on: demo traffic, simulated for hackathon demonstration");
  loop(checkIn, 20, 40);
  loop(bedChurn, 15, 30);
  loop(doctorStep, 10, 15);
}
