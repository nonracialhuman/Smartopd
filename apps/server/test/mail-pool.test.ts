import { describe, expect, it } from "vitest";
import { MailPool } from "../src/notify/mail-pool";

const job = (n: number, priority?: "high" | "normal") => ({
  smtpUrl: "json:", from: "SmartOPD <alerts@example.test>", to: `p${n}@example.test`, subject: `alert ${n}`, text: "hello", priority,
});

describe("mail worker pool", () => {
  it("delivers many emails in parallel on separate worker threads", async () => {
    const pool = new MailPool(3);
    const results = await Promise.all(Array.from({ length: 9 }, (_, i) => pool.send(job(i))));
    expect(results.every((r) => r.ok)).toBe(true);
    const threads = new Set(results.map((r) => r.threadId));
    expect(threads.size).toBeGreaterThan(1);
    expect(threads.size).toBeLessThanOrEqual(3);
    await pool.close();
  });

  it("sends high-priority alerts before queued normal ones", async () => {
    const pool = new MailPool(1);
    const order: string[] = [];
    const track = (label: string, p: Promise<unknown>) => p.then(() => order.push(label));
    const all = [
      track("normal-1", pool.send(job(1))),   // takes the only worker immediately
      track("normal-2", pool.send(job(2))),
      track("normal-3", pool.send(job(3))),
      track("HIGH", pool.send(job(4, "high"))),
    ];
    await Promise.all(all);
    expect(order[0]).toBe("normal-1");
    expect(order.indexOf("HIGH")).toBeLessThan(order.indexOf("normal-2"));
    await pool.close();
  });
});
