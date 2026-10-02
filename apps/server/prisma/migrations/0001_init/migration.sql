-- SmartOPD initial schema (hand-written, mirrors prisma/schema.prisma)

CREATE TYPE "Priority" AS ENUM ('EMERGENCY', 'URGENT', 'NORMAL');
CREATE TYPE "TokenStatus" AS ENUM ('WAITING', 'CALLED', 'IN_CONSULT', 'TRANSFERRED_TO_LAB', 'COMPLETED', 'NO_SHOW', 'CANCELLED');
CREATE TYPE "DoctorStatus" AS ENUM ('AVAILABLE', 'WITH_PATIENT', 'ON_BREAK', 'OFFLINE');
CREATE TYPE "BedType" AS ENUM ('GENERAL', 'ICU', 'OXYGEN');
CREATE TYPE "BedStatus" AS ENUM ('VACANT', 'OCCUPIED', 'CLEANING', 'RESERVED');
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'DOCTOR', 'RECEPTIONIST');

CREATE TABLE "Department" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "avgConsultMinutes" INTEGER NOT NULL DEFAULT 8,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

CREATE TABLE "Doctor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "room" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "status" "DoctorStatus" NOT NULL DEFAULT 'AVAILABLE',
  "currentTokenId" TEXT,
  CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Doctor_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Patient" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "age" INTEGER,
  CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Patient_phone_idx" ON "Patient"("phone");

CREATE TABLE "Token" (
  "id" TEXT NOT NULL,
  "tokenNumber" INTEGER NOT NULL,
  "serviceDate" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "doctorId" TEXT,
  "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
  "status" "TokenStatus" NOT NULL DEFAULT 'WAITING',
  "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "calledAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "Token_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Token_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Token_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Token_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Token_departmentId_serviceDate_tokenNumber_key" ON "Token"("departmentId", "serviceDate", "tokenNumber");
CREATE INDEX "Token_departmentId_status_idx" ON "Token"("departmentId", "status");

CREATE TABLE "Ward" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "BedType" NOT NULL,
  "totalBeds" INTEGER NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bed" (
  "id" TEXT NOT NULL,
  "wardId" TEXT NOT NULL,
  "bedNumber" TEXT NOT NULL,
  "status" "BedStatus" NOT NULL DEFAULT 'VACANT',
  "patientName" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT,
  CONSTRAINT "Bed_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Bed_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Bed_wardId_bedNumber_key" ON "Bed"("wardId", "bedNumber");

CREATE TABLE "StaffUser" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "StaffRole" NOT NULL,
  "departmentId" TEXT,
  "doctorId" TEXT,
  CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffUser_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StaffUser_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");
CREATE UNIQUE INDEX "StaffUser_doctorId_key" ON "StaffUser"("doctorId");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessedCommand" (
  "requestId" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  CONSTRAINT "ProcessedCommand_pkey" PRIMARY KEY ("requestId")
);

CREATE TABLE "OtpChallenge" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- Every broadcast takes a number from this sequence; snapshots read last_value.
CREATE SEQUENCE "event_seq";
