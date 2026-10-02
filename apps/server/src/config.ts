import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  HOSPITAL_NAME: z.string().default("City General Hospital"),
  HOSPITAL_TZ: z.string().default("Asia/Kolkata"),
  SIMULATOR: z.enum(["0", "1"]).default("0"),
  NODE_ENV: z.string().default("development"),
  ALERT_EMAIL_FROM: z.string().default("SmartOPD <godsont259@gmail.com>"),
  SMTP_URL: z.string().default(""),
  PUBLIC_WEB_URL: z.string().default(""),
  MAIL_WORKERS: z.coerce.number().int().min(1).max(16).default(3),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  webOrigins: parsed.data.WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
  secret: new TextEncoder().encode(parsed.data.JWT_SECRET),
  publicWebUrl: (parsed.data.PUBLIC_WEB_URL || parsed.data.WEB_ORIGIN.split(",")[0] || "").trim().replace(/\/$/, ""),
  isProd: parsed.data.NODE_ENV === "production",
};
