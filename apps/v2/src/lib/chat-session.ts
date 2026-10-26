import { z } from "zod";

import { parseSseEvent } from "./sse-events";

import type { ChatSseEvent } from "./sse-events";

const pendingSchema = z.object({
  requestId: z.string(),
  conversationId: z.string(),
  characterId: z.string(),
  text: z.string(),
  baseTurn: z.number().int().positive(),
});
const sessionSchema = z.object({
  version: z.literal(1),
  conversationId: z.string().nullable(),
  pending: pendingSchema.nullable(),
});
const historySchema = z.object({
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      imageUrl: z.string().optional(),
    }),
  ),
  turn: z.number().int(),
});
export type PendingTurn = z.infer<typeof pendingSchema>;
export type ChatSession = z.infer<typeof sessionSchema>;
export type ChatBubble = {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  imageUrl?: string;
};

const key = (characterId: string) => `v2-chat-session:${characterId}`;

export const readChatSession = (characterId: string): ChatSession => {
  const empty: ChatSession = { version: 1, conversationId: null, pending: null };
  if (typeof window === "undefined") return empty;
  try {
    const parsed = sessionSchema.safeParse(
      JSON.parse(localStorage.getItem(key(characterId)) ?? "null"),
    );
    if (!parsed.success || (parsed.data.pending && parsed.data.pending.characterId !== characterId))
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
  if (!response.ok) throw new Error("会話履歴を読み込めませんでした。再試行してください。");
  const history = historySchema.parse(await response.json());
  return {
    bubbles: history.history.map((item) => ({
      role: item.role,
      text: item.content,
      imageUrl: item.imageUrl,
    })),
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
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
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
    await reader.cancel();
    reader.releaseLock();
  }
};

export const connectChatTurn = async (
  pending: PendingTurn,
  signal: AbortSignal,
  retry = false,
): Promise<ReadableStream<Uint8Array>> => {
  const response = await fetch(`/api/chat/${encodeURIComponent(pending.characterId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      conversationId: pending.conversationId,
      requestId: pending.requestId,
      text: pending.text,
      retry,
    }),
  });
  if (!response.ok || !response.body)
    throw new Error("返信を受け取れませんでした。再接続してください。");
  return response.body;
};
