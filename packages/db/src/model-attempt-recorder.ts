import { sql } from "drizzle-orm";
import { z } from "zod";

import { modelAttemptSchema } from "./model-attempt";
import { v2ModelAttemptAuditTable } from "./v2-schema";

import type { V2Db } from "./client";
import type { ModelAttempt } from "./model-attempt";

const identifierSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\p{L}\p{N}_.:/-]+$/u);
const scopeSchema = z
  .object({
    userId: identifierSchema,
    characterId: identifierSchema,
    conversationId: identifierSchema,
    runId: identifierSchema,
  })
  .strict();

export type ModelAttemptScope = z.infer<typeof scopeSchema>;

export class ModelAttemptAuditError extends Error {
  constructor() {
    super("モデル試行の監査情報を保存できません");
    this.name = "ModelAttemptAuditError";
  }
}

const ATTEMPT_INDEX = { primary: 0, "fallback-1": 1, "fallback-2": 2 } as const;

export const createModelAttemptRecorder = (
  db: V2Db,
  trustedScope: ModelAttemptScope,
): ((attempt: ModelAttempt) => Promise<void>) => {
  const parsedScope = scopeSchema.safeParse(trustedScope);
  if (!parsedScope.success) throw new ModelAttemptAuditError();
  const scope = Object.freeze(parsedScope.data);
  let callIndex = -1;
  let attemptIndex = -1;
  let previousStatus: ModelAttempt["status"] | null = null;
  let writing = false;

  return async (value) => {
    const parsed = modelAttemptSchema.safeParse(value);
    if (!parsed.success || writing) throw new ModelAttemptAuditError();
    const attempt = parsed.data;
    const nextAttemptIndex = ATTEMPT_INDEX[attempt.route];
    const nextCallIndex = attempt.route === "primary" ? callIndex + 1 : callIndex;
    if (
      nextCallIndex < 0 ||
      nextCallIndex >= 5 ||
      (nextAttemptIndex > 0 &&
        (nextAttemptIndex !== attemptIndex + 1 || previousStatus !== "failed"))
    ) {
      throw new ModelAttemptAuditError();
    }
    writing = true;
    try {
      await db
        .insert(v2ModelAttemptAuditTable)
        .values({
          id: crypto.randomUUID(),
          ...scope,
          callIndex: nextCallIndex,
          attemptIndex: nextAttemptIndex,
          attemptJson: JSON.stringify(attempt),
          createdAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: [
            v2ModelAttemptAuditTable.userId,
            v2ModelAttemptAuditTable.characterId,
            v2ModelAttemptAuditTable.conversationId,
            v2ModelAttemptAuditTable.runId,
            v2ModelAttemptAuditTable.callIndex,
            v2ModelAttemptAuditTable.attemptIndex,
          ],
          // 別 payload の再送で既存監査を上書きせず、同じ SQL の NOT NULL 制約で拒否する。
          set: {
            attemptJson: sql`case when ${v2ModelAttemptAuditTable.attemptJson} = excluded.attempt_json
          then ${v2ModelAttemptAuditTable.attemptJson} else null end`,
          },
        });
      callIndex = nextCallIndex;
      attemptIndex = nextAttemptIndex;
      previousStatus = attempt.status;
    } catch {
      throw new ModelAttemptAuditError();
    } finally {
      writing = false;
    }
  };
};
