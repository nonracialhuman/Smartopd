// Starts a throwaway local PostgreSQL (embedded-postgres) on port 54329 for machines without Postgres.
// Not needed when you have your own Postgres or Supabase: just set DATABASE_URL.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Keep the data folder OUT of OneDrive/Dropbox: file sync locks Postgres files and makes it hang.
const dir = process.env.SMARTOPD_PGDATA ?? join(process.env.LOCALAPPDATA ?? homedir(), "smartopd-pgdata");
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: 54329, persistent: true });
if (!existsSync(join(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try { await pg.createDatabase("smartopd"); } catch { /* exists */ }
console.log(`data folder: ${dir}`);
console.log("postgresql://postgres:postgres@localhost:54329/smartopd  (Ctrl+C to stop)");
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
