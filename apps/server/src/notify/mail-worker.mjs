// Runs in a worker thread: owns one nodemailer transport and sends jobs posted by the pool.
// Plain .mjs so it needs no TypeScript loader inside the thread.
import { parentPort, threadId } from "node:worker_threads";
import nodemailer from "nodemailer";

const transports = new Map();
const transportFor = (url) => {
  let t = transports.get(url);
  if (!t) {
    // "json:" builds the message without a network call (tests, dry runs)
    t = nodemailer.createTransport(url === "json:" ? { jsonTransport: true } : url);
    transports.set(url, t);
  }
  return t;
};

parentPort.on("message", async (job) => {
  try {
    await transportFor(job.smtpUrl).sendMail({ from: job.from, to: job.to, subject: job.subject, text: job.text });
    parentPort.postMessage({ id: job.id, ok: true, threadId });
  } catch (err) {
    parentPort.postMessage({ id: job.id, ok: false, threadId, error: String(err?.message ?? err) });
  }
});
