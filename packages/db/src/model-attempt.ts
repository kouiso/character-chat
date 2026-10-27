import { z } from "zod";

const labelSchema = z
  .string()
  .max(200)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _+./:()-]{0,199}$/u);
const safeIntegerSchema = z.number().int().max(Number.MAX_SAFE_INTEGER);

export const modelAttemptSchema = z
  .object({
    route: z.enum(["primary", "fallback-1", "fallback-2"]),
    requestedModel: labelSchema,
    model: labelSchema.nullable(),
    provider: labelSchema.nullable(),
    status: z.enum(["ok", "failed"]),
    reason: z
      .enum([
        "refusal",
        "timeout",
        "rate-limit",
        "server-error",
        "connection",
        "empty",
        "output-limit",
        "cancelled",
        "unsafe-provider",
        "non-retryable",
        "protocol",
      ])
      .nullable(),
    latencyMs: safeIntegerSchema.nonnegative(),
    timeoutMs: safeIntegerSchema.positive(),
  })
  .strict()
  .refine(
    (attempt) => (attempt.status === "ok") === (attempt.reason === null),
    "試行の状態と理由が一致しません",
  )
  .readonly();

export const modelAttemptsSchema = z.array(modelAttemptSchema).max(3).readonly();
export type ModelAttempt = z.infer<typeof modelAttemptSchema>;

export const modelCallSchema = z
  .object({
    purpose: z.enum(["generate", "extend", "regenerate"]),
    attempts: modelAttemptsSchema,
  })
  .strict()
  .readonly();

export const modelCallsSchema = z.array(modelCallSchema).max(5).readonly();
export type ModelCall = z.infer<typeof modelCallSchema>;
