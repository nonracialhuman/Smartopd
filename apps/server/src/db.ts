import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";
import { config } from "./config";

const url = config.DATABASE_URL;
const adapter = new PrismaPg({
  connectionString: url,
  max: 12,
  ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
});

export const prisma = new PrismaClient({ adapter });
export type Tx = Prisma.TransactionClient;
export { Prisma };

/** YYYY-MM-DD in the hospital's timezone. */
export function serviceDateFor(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.HOSPITAL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
