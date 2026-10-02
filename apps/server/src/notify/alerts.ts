import type { Priority } from "@smartopd/shared";
import { config } from "../config";
import { prisma } from "../db";
import { logger } from "../logger";
import { MailPool } from "./mail-pool";

export interface AlertInfo {
  tokenId: string;
  label: string;
  priority: Priority;
  department: string;
  patientName: string;
  email: string;
  reason: "check-in" | "re-triage";
}

export type MailStatus = "sent" | "logged-only" | "failed";

const pool = new MailPool(config.MAIL_WORKERS);

/**
 * Sends through SMTP_URL on a pool of worker threads; with no SMTP_URL the mail is only logged (prototype default).
 * Staff priority alerts pass priority "high" so they go ahead of queued patient emails.
 */
export async function deliver(to: string, subject: string, text: string, priority: "high" | "normal" = "normal"): Promise<MailStatus> {
  if (!config.SMTP_URL) {
    logger.warn(`EMAIL (not sent, SMTP_URL empty) to ${to}: ${subject}`);
    return "logged-only";
  }
  const r = await pool.send({ smtpUrl: config.SMTP_URL, from: config.ALERT_EMAIL_FROM, to, subject, text, priority });
  if (!r.ok) logger.error({ error: r.error, to }, "email failed");
  return r.ok ? "sent" : "failed";
}

const RANK: Record<string, string> = { EMERGENCY: "Priority 1 · Emergency", URGENT: "Priority 2 · Urgent" };
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");

/**
 * Email to the patient (only if they gave an email at booking) when their token is
 * priority 1 (Emergency) or priority 2 (Urgent), at check-in or after a nurse/doctor re-triage.
 * With no SMTP_URL the mail is only logged (prototype default).
 */
export async function sendPriorityAlert(a: AlertInfo): Promise<void> {
  const tag = RANK[a.priority] ?? a.priority;
  const first = a.patientName.split(" ")[0];
  const subject = `[SmartOPD] ${tag}: token ${a.label}`;
  const text = [
    `Hi ${first},`,
    ``,
    a.reason === "re-triage"
      ? `Our team has marked your token ${a.label} as ${tag.split(" · ")[1]?.toLowerCase()}, so you will be seen ahead of routine patients.`
      : `Your token ${a.label} is marked ${tag.split(" · ")[1]?.toLowerCase()}, so you will be seen ahead of routine patients.`,
    ``,
    `Department: ${a.department} · ${config.HOSPITAL_NAME}`,
    `Please stay close to the department. We'll email you again when you're 2nd in line and when you're next.`,
    config.publicWebUrl ? `Watch your place live: ${config.publicWebUrl}/token/${a.tokenId}` : ``,
    ``,
    `If you feel worse, tell the front desk or go to Casualty right away.`,
    `Demo hospital: this is a hackathon prototype, not a clinical system.`,
  ].join("\n");

  const status = await deliver(a.email, subject, text, "high");
  await prisma.auditLog.create({
    data: { actor: "system", action: "alert.email", entity: "Token", entityId: a.tokenId, after: { to: mask(a.email), subject, status } },
  });
}
