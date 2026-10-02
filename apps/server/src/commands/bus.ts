import { ZodError, type ZodTypeAny } from "zod";
import {
  bedUpdateSchema, callNextSchema, doctorStatusSchema, retriageSchema, simSetSchema, tokenCreateSchema, tokenIdSchema, wardVerifySchema,
  type Ack, type CommandName, type ErrorCode,
} from "@smartopd/shared";
import { prisma, Prisma, type Tx } from "../db";
import { Actor, AppError, requireRole } from "../errors";
import type { Outcome } from "../domain/effects";
import {
  callNext, createToken, retriage, transition, updateBedStatus, updateDoctorStatus, verifyWard,
} from "../domain/services";
import { applyEffects, publishAdmin, getIo } from "../realtime/hub";
import { setSimulator } from "../sim/simulator";
import { logger } from "../logger";

interface CommandDef {
  schema: ZodTypeAny;
  run: (tx: Tx, payload: any, actor: Actor) => Promise<Outcome<unknown>>;
}

const move = (to: Parameters<typeof transition>[2]): CommandDef["run"] => (tx, p, actor) => transition(tx, p.tokenId, to, actor);

const registry: Record<Exclude<CommandName, "sim:set">, CommandDef> = {
  "token:create": { schema: tokenCreateSchema, run: (tx, p, a) => createToken(tx, p, a) },
  "queue:call-next": { schema: callNextSchema, run: (tx, p, a) => callNext(tx, p, a) },
  "queue:start-consult": { schema: tokenIdSchema, run: move("IN_CONSULT") },
  "queue:mark-completed": { schema: tokenIdSchema, run: move("COMPLETED") },
  "queue:transfer-lab": { schema: tokenIdSchema, run: move("TRANSFERRED_TO_LAB") },
  "queue:no-show": { schema: tokenIdSchema, run: move("NO_SHOW") },
  "queue:retriage": { schema: retriageSchema, run: (tx, p, a) => retriage(tx, p, a) },
  "bed:update-status": { schema: bedUpdateSchema, run: (tx, p, a) => updateBedStatus(tx, p, a) },
  "ward:verify": { schema: wardVerifySchema, run: (tx, p, a) => verifyWard(tx, p, a) },
  "doctor:update-status": { schema: doctorStatusSchema, run: (tx, p, a) => updateDoctorStatus(tx, p, a) },
};

const fail = (code: ErrorCode, message: string): Ack<never> => ({ ok: false, error: { code, message } });

async function stored(requestId: string): Promise<Ack<unknown> | null> {
  const row = await prisma.processedCommand.findUnique({ where: { requestId } });
  return row ? { ok: true, data: row.result } : null;
}

export async function execute(name: string, payload: unknown, actor: Actor): Promise<Ack<unknown>> {
  try {
    if (name === "sim:set") {
      requireRole(actor, ["ADMIN"]);
      const { enabled } = simSetSchema.parse(payload);
      setSimulator(enabled);
      getIo()?.to("admin:dashboard").emit("sim:state", { enabled });
      void publishAdmin();
      return { ok: true, data: { enabled } };
    }
    const def = registry[name as keyof typeof registry];
    if (!def) return fail("NOT_FOUND", `Unknown command "${name}".`);

    const parsed = def.schema.parse(payload) as { requestId?: string };
    const requestId = parsed.requestId;
    if (requestId) {
      const hit = await stored(requestId);
      if (hit) return hit;
    }

    let out: Outcome<unknown>;
    try {
      out = await prisma.$transaction(
        async (tx) => {
          const o = await def.run(tx, parsed, actor);
          if (requestId) await tx.processedCommand.create({ data: { requestId, command: name, result: o.result as never } });
          return o;
        },
        { timeout: 10_000, maxWait: 5_000 },
      );
    } catch (e) {
      // lost a race against an identical request: return the winner's result
      if (requestId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const hit = await stored(requestId);
        if (hit) return hit;
      }
      throw e;
    }
    void applyEffects(out.effects);
    return { ok: true, data: out.result };
  } catch (e) {
    if (e instanceof ZodError) return fail("VALIDATION", e.issues[0]?.message ?? "Some details look wrong. Check the form and try again.");
    if (e instanceof AppError) return fail(e.code, e.message);
    logger.error({ err: e, command: name }, "command failed");
    return fail("INTERNAL", "Something went wrong on our side. Please try again in a moment.");
  }
}
