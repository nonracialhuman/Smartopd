import { prisma, type Tx } from "../db";
import type { Outcome } from "../domain/effects";
import { applyEffects } from "../realtime/hub";

/** Run domain work in a transaction and broadcast only after commit. Used by the simulator. */
export async function runDirect<T>(fn: (tx: Tx) => Promise<Outcome<T>>): Promise<T> {
  const out = await prisma.$transaction(fn, { timeout: 10_000, maxWait: 5_000 });
  void applyEffects(out.effects);
  return out.result;
}
