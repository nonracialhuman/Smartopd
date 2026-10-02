import { z } from "zod";
import { BED_STATUSES, DOCTOR_STATUSES, PRIORITIES } from "./domain";

const requestId = z.string().min(8).max(64).optional();
const id = z.string().min(1).max(64);

export const otpRequestSchema = z.object({
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
});

export const loginSchema = z.object({
  email: z.string().email("Enter your work email"),
  password: z.string().min(1, "Enter your password").max(200),
});

export const tokenCreateSchema = z.object({
  requestId,
  name: z.string().trim().min(2, "Enter your full name").max(80),
  phone: z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
  age: z.number().int().min(0).max(120).optional(),
  /** optional: only patients who give an email receive queue alerts */
  email: z.string().trim().toLowerCase().email("Enter a valid email address, or leave it empty").max(120).optional(),
  departmentId: id,
  priority: z.enum(["URGENT", "NORMAL"]),
  otpChallengeId: id,
  otpCode: z.string().regex(/^\d{4}$/, "Enter the 4-digit code"),
});

export const callNextSchema = z.object({ requestId, doctorId: id });
export const tokenIdSchema = z.object({ requestId, tokenId: id });
export const retriageSchema = z.object({ requestId, tokenId: id, priority: z.enum(PRIORITIES) });
export const bedUpdateSchema = z.object({
  requestId,
  bedId: id,
  status: z.enum(BED_STATUSES),
  expectedVersion: z.number().int().min(0),
  patientName: z.string().trim().max(80).optional(),
});
export const wardVerifySchema = z.object({ requestId, wardId: id });
export const doctorStatusSchema = z.object({ requestId, doctorId: id, status: z.enum(DOCTOR_STATUSES) });
export const simSetSchema = z.object({ requestId, enabled: z.boolean() });

export type TokenCreateInput = z.infer<typeof tokenCreateSchema>;
export type CallNextInput = z.infer<typeof callNextSchema>;
export type TokenIdInput = z.infer<typeof tokenIdSchema>;
export type RetriageInput = z.infer<typeof retriageSchema>;
export type BedUpdateInput = z.infer<typeof bedUpdateSchema>;
export type WardVerifyInput = z.infer<typeof wardVerifySchema>;
export type DoctorStatusInput = z.infer<typeof doctorStatusSchema>;
export type SimSetInput = z.infer<typeof simSetSchema>;
