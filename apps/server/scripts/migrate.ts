import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see apps/server/.env.example)");

const client = new pg.Client({ connectionString: url, ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined });
await client.connect();

if (process.argv.includes("--reset")) {
  console.log("[migrate] --reset: dropping public schema");
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}

await client.query(`CREATE TABLE IF NOT EXISTS "_smartopd_migrations" (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const done = new Set((await client.query<{ name: string }>(`SELECT name FROM "_smartopd_migrations"`)).rows.map((r) => r.name));

const names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
for (const name of names) {
  const file = join(dir, name, "migration.sql");
  if (done.has(name) || !existsSync(file)) continue;
  console.log(`[migrate] applying ${name}`);
  try {
    await client.query("BEGIN");
    await client.query(readFileSync(file, "utf8"));
    await client.query(`INSERT INTO "_smartopd_migrations"(name) VALUES ($1)`, [name]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
console.log("[migrate] up to date");
await client.end();
