// engine 本体をクライアントへ持ち込まず、保存と配信の両境界で同じ公開契約を検証する。
import { z } from "zod";

import type { TurnEvent } from "@v2/engine";

export type ChatSseEvent =
  | Exclude<TurnEvent, { type: "error" | "generation" | "turn-meta" }>
  // 導入前に保存された事象には履歴省略数がないため、再生時も受け入れる。
  | (Omit<Extract<TurnEvent, { type: "turn-meta" }>, "omittedHistoryMessages"> & {
      omittedHistoryMessages?: number;
    })
  | { type: "error"; message: string; terminal?: boolean };

const finiteNumber = z.number().finite();
const judgeSchema = z.object({
  ok: z.boolean(),
  reasons: z.array(z.enum(["repetition", "voice", "format", "empty"])),
  warnings: z.array(z.string()),
  checks: z.object({
    ngram: z.object({
      ok: z.boolean(),
      ratio: finiteNumber,
      matchedPhrases: z.array(z.string()),
      exactRepeat: z.boolean(),
    }),
    nearDuplicate: z.object({
      ok: z.boolean(),
      matches: z.array(
        z.object({ sentence: z.string(), previous: z.string(), jaccard: finiteNumber }),
      ),
    }),
    voice: z.object({
      ok: z.boolean(),
      forbiddenPronoun: z.string().optional(),
      forbiddenAddress: z.string().optional(),
      thirdPersonSelf: z.string().optional(),
      endingsMismatch: z.boolean().optional(),
    }),
    format: z.object({ ok: z.boolean(), reason: z.string().optional() }),
    empty: z.object({ ok: z.boolean() }),
  }),
}) satisfies z.ZodType<Extract<TurnEvent, { type: "chunk" }>["judge"]>;

const eventSchemas = {
  token: z.object({ type: z.literal("token"), text: z.string() }),
  chunk: z.object({
    type: z.literal("chunk"),
    seq: finiteNumber,
    text: z.string(),
    judge: judgeSchema,
    attempt: finiteNumber,
    preExtend: z.boolean(),
  }),
  dropped: z.object({
    type: z.literal("dropped"),
    seq: finiteNumber,
    reasons: z.array(z.string()),
    attempt: finiteNumber,
  }),
  "turn-meta": z.object({
    type: z.literal("turn-meta"),
    extended: finiteNumber,
    truncated: z.enum(["chars", "deadline"]).nullable(),
    model: z.string(),
    latencyMs: finiteNumber,
    mechanicsPhase: z.enum(["conversation", "intimate", "erotic", "climax", "afterglow"]),
    preExtendVisibleChars: finiteNumber,
    omittedHistoryMessages: z.number().int().nonnegative().optional(),
  }),
  done: z.object({
    type: z.literal("done"),
    conversationId: z.string(),
    turn: finiteNumber,
    generationId: z.string().nullable(),
    // 塊ごとの表示予定時刻。無い・空の done は全部即出し（回復・旧形式）。
    sendAt: z.array(finiteNumber).optional(),
  }),
  error: z.object({
    type: z.literal("error"),
    message: z.string(),
    terminal: z.boolean().optional(),
  }),
} satisfies { [Type in ChatSseEvent["type"]]: z.ZodType<Extract<ChatSseEvent, { type: Type }>> };

const publicEventSchema = z.discriminatedUnion("type", [
  eventSchemas.token,
  eventSchemas.chunk,
  eventSchemas.dropped,
  eventSchemas["turn-meta"],
  eventSchemas.done,
  eventSchemas.error,
]) satisfies z.ZodType<ChatSseEvent>;

export const parseChatSseEvent = (value: unknown): ChatSseEvent | null => {
  const parsed = publicEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const isChatSseEvent = (value: unknown): value is ChatSseEvent =>
  parseChatSseEvent(value) !== null;

export const parseSseEvent = (eventName: string, dataLine: string): ChatSseEvent | null => {
  try {
    const data: unknown = JSON.parse(dataLine);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const payloadType: unknown = Reflect.get(data, "type");
    if (payloadType !== undefined && payloadType !== eventName) return null;
    return parseChatSseEvent({ ...data, type: eventName });
  } catch {
    return null;
  }
};
