import bcrypt from "bcryptjs";
import { prisma, serviceDateFor } from "../src/db";

const ago = (min: number) => new Date(Date.now() - min * 60_000);

export async function seed() {
  await prisma.$executeRaw`TRUNCATE "AuditLog","ProcessedCommand","OtpChallenge","StaffUser","Token","Patient","Doctor","Department","Bed","Ward" RESTART IDENTITY CASCADE`;
  await prisma.$executeRaw`ALTER SEQUENCE "event_seq" RESTART WITH 1`;

  const mk = (name: string, code: string, avg: number) => prisma.department.create({ data: { name, code, avgConsultMinutes: avg } });
  const [gm, pd, or] = [await mk("General Medicine", "GM", 8), await mk("Pediatrics", "PD", 10), await mk("Orthopedics", "OR", 12)];

  const doc = (name: string, room: string, departmentId: string, status: "AVAILABLE" | "ON_BREAK" = "AVAILABLE") =>
    prisma.doctor.create({ data: { name, room, departmentId, status } });
  const rao = await doc("Dr. Anita Rao", "Room 2", gm.id);
  const menon = await doc("Dr. Suresh Menon", "Room 3", gm.id);
  const kulkarni = await doc("Dr. Kavita Kulkarni", "Room 7", pd.id);
  const qureshi = await doc("Dr. Farhan Qureshi", "Room 11", or.id);
  await doc("Dr. Neha Bhatt", "Room 8", pd.id, "ON_BREAK");

  const hash = await bcrypt.hash("demo1234", 8);
  const staff = (email: string, name: string, role: "ADMIN" | "DOCTOR", d?: { id: string; departmentId: string }) =>
    prisma.staffUser.create({ data: { email: `${email}@citygeneral.demo`, name, role, passwordHash: hash, departmentId: d?.departmentId ?? null, doctorId: d?.id ?? null } });
  await staff("admin", "Priya Shah", "ADMIN");
  await staff("rao", rao.name, "DOCTOR", rao);
  await staff("menon", menon.name, "DOCTOR", menon);
  await staff("kulkarni", kulkarni.name, "DOCTOR", kulkarni);
  await staff("qureshi", qureshi.name, "DOCTOR", qureshi);

  const date = serviceDateFor();
  let n = 0;
  const token = async (
    dept: { id: string }, num: number, name: string, age: number, o: {
      priority?: "URGENT" | "NORMAL"; status: "WAITING" | "IN_CONSULT" | "COMPLETED" | "TRANSFERRED_TO_LAB";
      checkedMin: number; doctorId?: string; startedMin?: number; durMin?: number;
    },
  ) => {
    const p = await prisma.patient.create({ data: { name, phone: `98${String(10000000 + ++n * 7919).slice(0, 8)}`, age } });
    const started = o.startedMin !== undefined ? ago(o.startedMin) : null;
    return prisma.token.create({
      data: {
        tokenNumber: num, serviceDate: date, patientId: p.id, departmentId: dept.id, priority: o.priority ?? "NORMAL", status: o.status,
        checkedInAt: ago(o.checkedMin), doctorId: o.doctorId ?? null,
        calledAt: started ? new Date(started.getTime() - 60_000) : null, startedAt: started,
        completedAt: started && o.durMin ? new Date(started.getTime() + o.durMin * 60_000) : null,
      },
    });
  };

  await token(gm, 1, "Ramesh Iyer", 58, { status: "COMPLETED", checkedMin: 95, doctorId: rao.id, startedMin: 88, durMin: 7 });
  await token(gm, 2, "Sunita Patil", 34, { status: "COMPLETED", checkedMin: 90, doctorId: menon.id, startedMin: 80, durMin: 9 });
  await token(gm, 3, "Mohammed Ali", 41, { status: "COMPLETED", checkedMin: 84, doctorId: rao.id, startedMin: 79, durMin: 8 });
  await token(gm, 4, "Lata Deshmukh", 66, { status: "TRANSFERRED_TO_LAB", checkedMin: 78, doctorId: menon.id, startedMin: 69, durMin: 10 });
  const t5 = await token(gm, 5, "Vikram Nair", 29, { status: "IN_CONSULT", checkedMin: 60, doctorId: rao.id, startedMin: 3 });
  const t6 = await token(gm, 6, "Kavya Reddy", 47, { status: "IN_CONSULT", checkedMin: 55, doctorId: menon.id, startedMin: 5 });
  await prisma.doctor.update({ where: { id: rao.id }, data: { status: "WITH_PATIENT", currentTokenId: t5.id } });
  await prisma.doctor.update({ where: { id: menon.id }, data: { status: "WITH_PATIENT", currentTokenId: t6.id } });
  const waitingGm: [string, number, number, "URGENT" | "NORMAL"][] = [
    ["Harpreet Singh", 52, 40, "NORMAL"], ["Anjali Kulkarni", 38, 33, "NORMAL"], ["Girish Rao", 71, 28, "URGENT"],
    ["Farida Sheikh", 25, 21, "NORMAL"], ["Deepak Joshi", 62, 12, "NORMAL"],
  ];
  let num = 7;
  for (const [name, age, mins, priority] of waitingGm) await token(gm, num++, name, age, { status: "WAITING", checkedMin: mins, priority });

  await token(pd, 1, "Aarav Menon (child)", 6, { status: "COMPLETED", checkedMin: 70, doctorId: kulkarni.id, startedMin: 60, durMin: 11 });
  await token(pd, 2, "Myra Shah", 3, { status: "WAITING", checkedMin: 25 });
  await token(pd, 3, "Ishaan Verma", 9, { status: "WAITING", checkedMin: 15 });
  await token(pd, 4, "Zara Khan", 2, { status: "WAITING", checkedMin: 6, priority: "URGENT" });
  await token(or, 1, "Bhaskar Naidu", 63, { status: "WAITING", checkedMin: 20 });
  await token(or, 2, "Rekha Pillai", 55, { status: "WAITING", checkedMin: 9 });

  // wards, about 70% occupied, confirmed a few minutes ago
  const plan = [
    { name: "General Ward A", type: "GENERAL" as const, prefix: "G", total: 16, pad: 2, occ: 11, clean: 1, res: 1 },
    { name: "ICU", type: "ICU" as const, prefix: "ICU-", total: 6, pad: 2, occ: 4, clean: 0, res: 0 },
    { name: "Oxygen Ward", type: "OXYGEN" as const, prefix: "O2-", total: 10, pad: 2, occ: 7, clean: 1, res: 0 },
  ];
  const names = ["Gopal Rao", "Meena Kumari", "Sanjay Bose", "Fatima Begum", "Ravi Teja", "Leela Menon", "Arun Dutta", "Shobha Rani", "Kiran Patel", "Joseph D'Souza", "Hema Malini", "Prakash Jha"];
  for (const w of plan) {
    const ward = await prisma.ward.create({ data: { name: w.name, type: w.type, totalBeds: w.total, verifiedAt: ago(4), verifiedBy: "Priya Shah" } });
    for (let i = 1; i <= w.total; i++) {
      const status = i <= w.occ ? "OCCUPIED" : i <= w.occ + w.clean ? "CLEANING" : i <= w.occ + w.clean + w.res ? "RESERVED" : "VACANT";
      await prisma.bed.create({
        data: {
          wardId: ward.id, bedNumber: `${w.prefix}${String(i).padStart(w.pad, "0")}`, status,
          patientName: status === "OCCUPIED" || status === "RESERVED" ? names[(i + w.total) % names.length]! : null,
          updatedAt: ago(6 + (i % 5)), updatedBy: "Priya Shah",
        },
      });
    }
  }
  console.log("[seed] City General Hospital demo data ready (all data is fictional)");
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  seed().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
}
