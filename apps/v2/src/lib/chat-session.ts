import { z } from "zod";

import { createReconnectingChatStream } from "./chat-reconnect";
import { parseSseEvent } from "./sse-events";

import type { ChunkDeliverySnapshot } from "./chunk-delivery";
import type { ChatSseEvent } from "./sse-events";

export class ChatTurnError extends Error {
  readonly retryable: boolean;
  constructor(event: Extract<ChatSseEvent, { type: "error" }>) {
    super(event.message);
    this.name = "ChatTurnError";
    this.retryable = event.retryable !== false;
  }
}

export const mayRetryChatTurn = (cause: unknown): boolean =>
  !(cause instanceof ChatTurnError) || cause.retryable;

export class ChatHistoryError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("会話履歴を読み込めませんでした。再試行してください。");
    this.name = "ChatHistoryError";
    this.status = status;
  }
}

const pendingSchema = z.object({
  requestId: z.string().min(1).max(120),
  conversationId: z.string().min(1).max(120),
  characterId: z.string().min(1),
  text: z.string().min(1).max(4000),
  baseTurn: z.number().int().positive(),
  lastEventId: z.number().int().safe().nonnegative().optional(),
  terminalError: z.string().optional(),
});
const sessionSchema = z.object({
  version: z.literal(1),
  conversationId: z.string().min(1).max(120).nullable(),
  pending: pendingSchema.nullable(),
});
const timestampSchema = z.number().int().safe().nonnegative().max(8_640_000_000_000_000);
const deliverySchema = z.object({
  conversationId: z.string().min(1),
  turn: z.number().int().safe().positive(),
  generationId: z.string().nullable(),
  serverNow: timestampSchema,
  chunks: z.array(
    z.object({
      seq: z.number().int().safe().nonnegative(),
      text: z.string(),
      scheduledAt: timestampSchema,
    }),
  ),
});
const historySchema = z.object({
  conversationId: z.string().optional(),
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      turn: z.number().int().safe().positive().optional(),
    }),
  ),
  turn: z.number().int().safe().positive(),
  deliveries: z.array(deliverySchema).optional(),
});
export type PendingTurn = z.infer<typeof pendingSchema>;
export type ChatSession = z.infer<typeof sessionSchema>;
export type ChatBubble = {
  role: "user" | "assistant";
  text: string;
  turn?: number;
  pending?: boolean;
  delivery?: ChunkDeliverySnapshot;
};

const key = (characterId: string) => `v2-chat-session:${characterId}`;

export const readChatSession = (characterId: string): ChatSession => {
  const empty: ChatSession = { version: 1, conversationId: null, pending: null };
  if (typeof window === "undefined") return empty;
  try {
    const parsed = sessionSchema.safeParse(
      JSON.parse(localStorage.getItem(key(characterId)) ?? "null"),
    );
    if (
      !parsed.success ||
      (parsed.data.pending &&
        (parsed.data.pending.characterId !== characterId ||
          parsed.data.pending.conversationId !== parsed.data.conversationId))
    )
      return empty;
    return parsed.data;
  } catch {
    return empty;
  }
};

export const writeChatSession = (characterId: string, session: ChatSession): void => {
  localStorage.setItem(key(characterId), JSON.stringify(session));
};

export const loadChatHistory = async (
  characterId: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<{ bubbles: ChatBubble[]; nextTurn: number }> => {
  const response = await fetch(
    `/api/chat/${encodeURIComponent(characterId)}/history?conversationId=${encodeURIComponent(conversationId)}`,
    { signal },
  );
  signal.throwIfAborted();
  if (!response.ok) throw new ChatHistoryError(response.status);
  const parsed = historySchema.safeParse(await response.json());
  signal.throwIfAborted();
  if (!parsed.success)
    throw new Error("会話履歴の形式を確認できませんでした。読み直してください。");
  const history = parsed.data;
  if (history.conversationId && history.conversationId !== conversationId)
    throw new Error("会話履歴の識別子を確認できませんでした。");
  const snapshots = history.deliveries ?? [];
  const deliveries = new Map(snapshots.map((delivery) => [delivery.turn, delivery]));
  if (
    deliveries.size !== snapshots.length ||
    snapshots.some((delivery) => delivery.conversationId !== conversationId)
  )
    throw new Error("会話履歴の配送情報を確認できませんでした。");
  return {
    bubbles: history.history.map((item) => {
      if (item.role === "assistant" && history.deliveries !== undefined) {
        const delivery = item.turn === undefined ? undefined : deliveries.get(item.turn);
        if (!delivery) throw new Error("会話履歴の返信と配送情報が一致しませんでした。");
        return { role: item.role, text: "", turn: item.turn, delivery };
      }
      return { role: item.role, text: item.content, turn: item.turn };
    }),
    nextTurn: history.turn,
  };
};

const parseBlock = (block: string): ChatSseEvent | null => {
  const lines = block.split("\n");
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return event && data ? parseSseEvent(event, data) : null;
};

export const readChatEvents = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      yield* blocks.map(parseBlock).filter((event) => event !== null);
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
};

export const connectChatTurn = async (
  pending: PendingTurn,
  signal: AbortSignal,
  retry = false,
  onCursor?: (cursor: number) => void,
): Promise<ReadableStream<Uint8Array>> => {
  if (pending.terminalError !== undefined)
    throw new ChatTurnError({ type: "error", message: pending.terminalError, retryable: false });
  signal.throwIfAborted();
  const open = async (
    after: number,
    explicitRetry = false,
  ): Promise<ReadableStream<Uint8Array>> => {
    const response = await fetch(`/api/chat/${encodeURIComponent(pending.characterId)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "last-event-id": String(after) },
      signal,
      body: JSON.stringify({
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        turn: pending.baseTurn,
        text: pending.text,
        retry: explicitRetry,
      }),
    });
    if (!response.ok || response.status === 204 || !response.body)
      throw new Error("返信を受け取れませんでした。再接続してください。");
    return response.body;
  };
  const after = retry ? 0 : (pending.lastEventId ?? 0);
  const initial = await open(after, retry);
  return createReconnectingChatStream(initial, (cursor) => open(cursor), signal, {
    after,
    onCursor,
  });
};
