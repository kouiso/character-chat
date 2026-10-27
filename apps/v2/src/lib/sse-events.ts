// クライアント/サーバ両方から import する型だけの定義。実体は @v2/engine の TurnEvent
// （型のみの再 export なのでクライアントバンドルに engine の実装は入らん）。
import type { TurnEvent } from "@v2/engine";

export type ChatChunkDelivery = Omit<Extract<TurnEvent, { type: "delivery" }>, "type">;

export type ChatSseEvent =
  | Exclude<TurnEvent, { type: "error" | "chunk" }>
  | (Extract<TurnEvent, { type: "chunk" }> & { scheduledAt?: number })
  | {
      type: "error";
      message: string;
      retryable?: boolean;
      code?: "recovery_conflict" | "generation_exhausted";
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8_640_000_000_000_000;

const isDelivery = (value: Record<string, unknown>): boolean =>
  typeof value.conversationId === "string" &&
  value.conversationId.length > 0 &&
  typeof value.turn === "number" &&
  Number.isSafeInteger(value.turn) &&
  value.turn >= 1 &&
  (value.generationId === null || typeof value.generationId === "string") &&
  isTimestamp(value.serverNow) &&
  Array.isArray(value.chunks) &&
  value.chunks.every(
    (chunk: unknown) =>
      isRecord(chunk) &&
      typeof chunk.seq === "number" &&
      Number.isSafeInteger(chunk.seq) &&
      chunk.seq >= 0 &&
      typeof chunk.text === "string" &&
      isTimestamp(chunk.scheduledAt),
  );

const isChatSseEvent = (value: unknown): value is ChatSseEvent => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "delivery") return isDelivery(value);
  if (value.type === "error") {
    return (
      typeof value.message === "string" &&
      (value.retryable === undefined || typeof value.retryable === "boolean") &&
      (value.code === undefined ||
        ["recovery_conflict", "generation_exhausted"].includes(String(value.code)))
    );
  }
  return true;
};

export const parseSseEvent = (eventName: string, dataLine: string): ChatSseEvent | null => {
  try {
    const data: unknown = JSON.parse(dataLine);
    if (typeof data !== "object" || data === null) return null;
    const event: unknown = { ...data, type: eventName };
    return isChatSseEvent(event) ? event : null;
  } catch {
    return null;
  }
};
