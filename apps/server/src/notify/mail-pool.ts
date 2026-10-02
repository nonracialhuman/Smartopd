import { Worker } from "node:worker_threads";
import { logger } from "../logger";

export interface MailJob {
  smtpUrl: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  /** "high" jobs (staff Emergency/Urgent alerts) are sent before queued "normal" ones. */
  priority?: "high" | "normal";
}
export interface MailResult { ok: boolean; threadId?: number; error?: string }

interface Slot { worker: Worker; busy: string | null }
interface Waiting { id: string; job: MailJob; resolve: (r: MailResult) => void; timer?: ReturnType<typeof setTimeout> }

const JOB_TIMEOUT_MS = 20_000;
const WORKER_FILE = new URL("./mail-worker.mjs", import.meta.url);

/**
 * A pool of worker threads that deliver email, so SMTP connect/TLS/send never runs on the
 * main event loop and several alerts go out in parallel. Workers start lazily and are respawned if one dies.
 */
export class MailPool {
  private slots: Slot[] = [];
  private queue: Waiting[] = [];
  private inflight = new Map<string, Waiting>();
  private seq = 0;

  constructor(private size: number) {}

  send(job: MailJob): Promise<MailResult> {
    return new Promise((resolve) => {
      const w: Waiting = { id: `m${++this.seq}`, job, resolve };
      if (job.priority === "high") {
        const at = this.queue.findIndex((q) => q.job.priority !== "high");
        this.queue.splice(at === -1 ? this.queue.length : at, 0, w);
      } else this.queue.push(w);
      this.pump();
    });
  }

  private spawn(): Slot {
    const worker = new Worker(WORKER_FILE);
    worker.unref(); // an idle pool must not keep the process alive
    const slot: Slot = { worker, busy: null };
    worker.on("message", (m: { id: string; ok: boolean; threadId: number; error?: string }) => {
      const w = this.inflight.get(m.id);
      if (w) this.finish(w, { ok: m.ok, threadId: m.threadId, error: m.error });
      slot.busy = null;
      this.pump();
    });
    const dead = (err?: unknown) => {
      if (err) logger.error({ err }, "mail worker crashed");
      const w = slot.busy ? this.inflight.get(slot.busy) : undefined;
      if (w) this.finish(w, { ok: false, error: "mail worker stopped" });
      this.slots = this.slots.filter((s) => s !== slot);
      this.pump();
    };
    worker.on("error", dead);
    worker.on("exit", () => dead());
    this.slots.push(slot);
    return slot;
  }

  private finish(w: Waiting, r: MailResult) {
    clearTimeout(w.timer);
    this.inflight.delete(w.id);
    w.resolve(r);
  }

  private pump() {
    while (this.queue.length) {
      const slot = this.slots.find((s) => !s.busy) ?? (this.slots.length < this.size ? this.spawn() : undefined);
      if (!slot) return;
      const w = this.queue.shift()!;
      slot.busy = w.id;
      this.inflight.set(w.id, w);
      w.timer = setTimeout(() => { if (this.inflight.has(w.id)) { this.finish(w, { ok: false, error: "timed out" }); void slot.worker.terminate(); } }, JOB_TIMEOUT_MS);
      slot.worker.postMessage({ id: w.id, ...w.job });
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}
