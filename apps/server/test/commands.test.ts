import { beforeAll, describe, expect, it } from "vitest";
import type { Ack, SessionUser } from "@smartopd/shared";
import { prisma } from "../src/db";
import { execute } from "../src/commands/bus";
import type { Actor } from "../src/errors";
import { seed } from "../scripts/seed";

let raoActor: Actor, menonActor: Actor, adminActor: Actor, kulkarniActor: Actor;
let rao: { id: string }, menon: { id: string }, kulkarni: { id: string };
let gmId: string;
const patient: Actor = { kind: "patient" };
let rid = 0;
const id = (p = "req") => `${p}-${Date.now()}-${++rid}-${Math.random().toString(36).slice(2, 8)}`;

async function actorFor(email: string): Promise<Actor> {
  const s = await prisma.staffUser.findUniqueOrThrow({ where: { email: `${email}@citygeneral.demo` } });
  const user: SessionUser = { id: s.id, email: s.email, name: s.name, role: s.role, departmentId: s.departmentId, doctorId: s.doctorId };
  return { kind: "staff", user };
}
const code = (a: Ack<unknown>) => (a.ok ? "OK" : a.error.code);

async function finishActive(doctorId: string, actor: Actor) {
  const t = await prisma.token.findFirst({ where: { doctorId, status: { in: ["CALLED", "IN_CONSULT"] } } });
  if (!t) return;
  if (t.status === "CALLED") await execute("queue:start-consult", { tokenId: t.id }, actor);
  await execute("queue:mark-completed", { tokenId: t.id }, actor);
}

async function checkIn(phone: string, name = "Test Patient", priority: "NORMAL" | "URGENT" = "NORMAL", email?: string) {
  const ch = await prisma.otpChallenge.create({ data: { phone, code: "1234", expiresAt: new Date(Date.now() + 300_000) } });
  return execute("token:create", { requestId: id(), name, phone, email, departmentId: gmId, priority, otpChallengeId: ch.id, otpCode: "1234" }, patient);
}

beforeAll(async () => {
  await seed();
  raoActor = await actorFor("rao"); menonActor = await actorFor("menon"); adminActor = await actorFor("admin"); kulkarniActor = await actorFor("kulkarni");
  rao = await prisma.doctor.findFirstOrThrow({ where: { name: "Dr. Anita Rao" } });
  menon = await prisma.doctor.findFirstOrThrow({ where: { name: "Dr. Suresh Menon" } });
  kulkarni = await prisma.doctor.findFirstOrThrow({ where: { name: "Dr. Kavita Kulkarni" } });
  gmId = (await prisma.department.findUniqueOrThrow({ where: { code: "GM" } })).id;
  await finishActive(rao.id, raoActor);
  await finishActive(menon.id, menonActor);
});

describe("calling patients", () => {
  it("a double tap with two requestIds calls exactly one patient", async () => {
    const [a, b] = await Promise.all([
      execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor),
      execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor),
    ]);
    expect([code(a), code(b)].sort()).toEqual(["DOCTOR_BUSY", "OK"]);
    expect(await prisma.token.count({ where: { doctorId: rao.id, status: "CALLED" } })).toBe(1);
    await finishActive(rao.id, raoActor);
  });

  it("a replayed requestId returns an identical result", async () => {
    const requestId = id("replay");
    const first = await execute("queue:call-next", { requestId, doctorId: rao.id }, raoActor);
    const again = await execute("queue:call-next", { requestId, doctorId: rao.id }, raoActor);
    expect(first.ok).toBe(true);
    expect(again).toEqual(first);
    await finishActive(rao.id, raoActor);
  });

  it("two doctors calling at once get the two highest-priority waiting patients", async () => {
    const waiting = await prisma.token.findMany({
      where: { departmentId: gmId, status: "WAITING" }, orderBy: [{ priority: "asc" }, { checkedInAt: "asc" }], take: 2,
    });
    const [a, b] = await Promise.all([
      execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor),
      execute("queue:call-next", { requestId: id(), doctorId: menon.id }, menonActor),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const called = [(a as any).data.tokenId, (b as any).data.tokenId].sort();
    expect(called).toEqual(waiting.map((t) => t.id).sort());
    await finishActive(rao.id, raoActor);
    await finishActive(menon.id, menonActor);
  });

  it("a doctor can't call for another doctor's room", async () => {
    const r = await execute("queue:call-next", { requestId: id(), doctorId: menon.id }, raoActor);
    expect(code(r)).toBe("FORBIDDEN");
  });

  it("a patient can't run staff commands", async () => {
    const r = await execute("queue:call-next", { requestId: id(), doctorId: rao.id }, patient);
    expect(code(r)).toBe("UNAUTHENTICATED");
  });

  it("COMPLETED -> IN_CONSULT is rejected", async () => {
    const called = await execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor);
    const tokenId = (called as any).data.tokenId as string;
    await execute("queue:start-consult", { tokenId }, raoActor);
    await execute("queue:mark-completed", { tokenId }, raoActor);
    const r = await execute("queue:start-consult", { tokenId }, raoActor);
    expect(code(r)).toBe("INVALID_TRANSITION");
  });
});

describe("beds", () => {
  it("a stale bed edit gets CONFLICT and an audit row exists", async () => {
    const bed = await prisma.bed.findFirstOrThrow({ where: { status: "VACANT" } });
    const ok = await execute("bed:update-status", { requestId: id(), bedId: bed.id, status: "OCCUPIED", expectedVersion: bed.version }, adminActor);
    expect(ok.ok).toBe(true);
    const stale = await execute("bed:update-status", { requestId: id(), bedId: bed.id, status: "CLEANING", expectedVersion: bed.version }, adminActor);
    expect(code(stale)).toBe("CONFLICT");
    expect(await prisma.auditLog.count({ where: { entity: "Bed", entityId: bed.id, action: "bed.status" } })).toBeGreaterThanOrEqual(1);
  });

  it("a doctor can't change beds", async () => {
    const bed = await prisma.bed.findFirstOrThrow();
    const r = await execute("bed:update-status", { requestId: id(), bedId: bed.id, status: "CLEANING", expectedVersion: bed.version }, raoActor);
    expect(code(r)).toBe("FORBIDDEN");
  });
});

describe("check-in", () => {
  it("5 concurrent check-ins get 5 distinct labels", async () => {
    const results = await Promise.all([0, 1, 2, 3, 4].map((i) => checkIn(`9000000${100 + i}`, `Concurrent ${i}`)));
    expect(results.every((r) => r.ok)).toBe(true);
    const labels = results.map((r) => (r as any).data.label);
    expect(new Set(labels).size).toBe(5);
  });

  it("a wrong OTP gets OTP_INVALID", async () => {
    const ch = await prisma.otpChallenge.create({ data: { phone: "9000000200", code: "4321", expiresAt: new Date(Date.now() + 300_000) } });
    const r = await execute("token:create", {
      requestId: id(), name: "Wrong Code", phone: "9000000200", departmentId: gmId, priority: "NORMAL", otpChallengeId: ch.id, otpCode: "0000",
    }, patient);
    expect(code(r)).toBe("OTP_INVALID");
    expect((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: ch.id } })).attempts).toBe(1);
  });

  it("patients can't self-select Emergency", async () => {
    const r = await execute("token:create", {
      requestId: id(), name: "Sneaky", phone: "9000000201", departmentId: gmId, priority: "EMERGENCY", otpChallengeId: "x", otpCode: "1234",
    }, patient);
    expect(code(r)).toBe("VALIDATION");
  });

  it("priority emails go to the patient's own email, only if they gave one", async () => {
    const withMail = (await checkIn("9000000202", "Urgent Mail", "URGENT", "urgent@example.test")) as any;
    const noMail = (await checkIn("9000000203", "Urgent NoMail", "URGENT")) as any;
    const routine = (await checkIn("9000000204", "Routine Mail", "NORMAL", "routine@example.test")) as any;
    const find = async (tokenId: string) => {
      for (let i = 0; i < 30; i++) {
        const row = await prisma.auditLog.findFirst({ where: { action: "alert.email", entityId: tokenId } });
        if (row) return row;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    };
    const row = await find(withMail.data.tokenId);
    expect(row).not.toBeNull();
    expect((row!.after as any).to).toBe("u***@example.test");
    await new Promise((r) => setTimeout(r, 400));
    expect(await prisma.auditLog.findFirst({ where: { action: "alert.email", entityId: noMail.data.tokenId } })).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "alert.email", entityId: routine.data.tokenId } })).toBeNull();
  });
});

describe("missed patients", () => {
  it("first no-show re-queues at the end; second no-show removes the patient", async () => {
    await prisma.token.updateMany({ where: { departmentId: gmId, status: "WAITING" }, data: { status: "CANCELLED" } });
    const larry = (await checkIn("9000000300", "Late Larry")) as any;
    const priya = (await checkIn("9000000301", "Prompt Priya")) as any;
    const larryId = larry.data.tokenId as string;

    // Larry is first in line and is called
    const first = await execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor);
    expect((first as any).data.tokenId).toBe(larryId);

    // first miss: back to WAITING behind Priya, doctor freed
    const miss1 = await execute("queue:no-show", { tokenId: larryId }, raoActor);
    expect((miss1 as any).data).toMatchObject({ status: "WAITING", requeued: true });
    const row = await prisma.token.findUniqueOrThrow({ where: { id: larryId } });
    expect(row).toMatchObject({ status: "WAITING", doctorId: null, missedCount: 1 });
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: rao.id } })).status).toBe("AVAILABLE");
    const order = await prisma.token.findMany({ where: { departmentId: gmId, status: "WAITING" }, orderBy: [{ priority: "asc" }, { checkedInAt: "asc" }] });
    expect(order.map((t) => t.id)).toEqual([priya.data.tokenId, larryId]);

    // Priya is seen; Larry is called again and misses again: removed for good
    const second = await execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor);
    expect((second as any).data.tokenId).toBe(priya.data.tokenId);
    await finishActive(rao.id, raoActor);
    await execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor);
    const miss2 = await execute("queue:no-show", { tokenId: larryId }, raoActor);
    expect((miss2 as any).data).toMatchObject({ status: "NO_SHOW", requeued: false });
    expect((await prisma.token.findUniqueOrThrow({ where: { id: larryId } })).status).toBe("NO_SHOW");
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: rao.id } })).status).toBe("AVAILABLE");
  });
});

describe("patient email alerts", () => {
  it("emails once at 2nd and once at 1st, only patients who gave an email", async () => {
    await prisma.token.updateMany({ where: { departmentId: gmId, status: "WAITING" }, data: { status: "CANCELLED" } });
    const mk = async (phone: string, name: string, email?: string) => {
      const ch = await prisma.otpChallenge.create({ data: { phone, code: "1234", expiresAt: new Date(Date.now() + 300_000) } });
      return (await execute("token:create", { requestId: id(), name, phone, email, departmentId: gmId, priority: "NORMAL", otpChallengeId: ch.id, otpCode: "1234" }, patient)) as any;
    };
    const a = await mk("9000000400", "Mail A", "a@example.test");
    const b = await mk("9000000401", "Mail B", "b@example.test");
    const c = await mk("9000000402", "No Mail C");
    const levels = async (tokenId: string) => {
      await new Promise((r) => setTimeout(r, 600));
      return (await prisma.auditLog.findMany({ where: { action: "alert.patient_email", entityId: tokenId } })).map((r) => (r.after as any).level).sort();
    };
    expect(await levels(a.data.tokenId)).toEqual(["NEXT"]);
    expect(await levels(b.data.tokenId)).toEqual(["SECOND"]);
    expect(await levels(c.data.tokenId)).toEqual([]);
    // A is called, so B becomes 1st and C 2nd; B is told "next" exactly once more
    await execute("queue:call-next", { requestId: id(), doctorId: rao.id }, raoActor);
    expect(await levels(b.data.tokenId)).toEqual(["NEXT", "SECOND"]);
    expect(await levels(c.data.tokenId)).toEqual([]);
    await finishActive(rao.id, raoActor);
  });

  it("rejects a malformed email", async () => {
    const r = await execute("token:create", { requestId: id(), name: "Bad Mail", phone: "9000000403", email: "nope", departmentId: gmId, priority: "NORMAL", otpChallengeId: "x", otpCode: "1234" }, patient);
    expect(code(r)).toBe("VALIDATION");
  });
});
