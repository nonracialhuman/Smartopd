// Generates the Prisma client. If the schema-engine binary can't be downloaded
// (blocked networks), retry with a stub engine: client generation doesn't need it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (env = {}) =>
  spawnSync("npx", ["prisma", "generate"], {
    cwd: root, encoding: "utf8", shell: true, env: { ...process.env, ...env },
  });

let r = run();
if (r.status !== 0) {
  const out = `${r.stdout}${r.stderr}`;
  if (/binaries\.prisma\.sh|schema-engine|ENOTFOUND|ECONN|fetch failed/i.test(out)) {
    console.warn("[generate] engine download failed, retrying with stub schema-engine");
    const dir = mkdtempSync(join(tmpdir(), "sopd-engine-"));
    const win = process.platform === "win32";
    const file = join(dir, win ? "schema-engine.cmd" : "schema-engine");
    writeFileSync(file, win ? "@echo schema-engine-cli 0.0.0\r\n" : '#!/bin/sh\necho "schema-engine-cli 0.0.0"\n');
    if (!win) chmodSync(file, 0o755);
    r = run({ PRISMA_SCHEMA_ENGINE_BINARY: file });
  }
}
process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
if (r.status !== 0) { console.error("[generate] prisma generate failed"); process.exit(r.status ?? 1); }
