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

// 保存済み会話を開き直せるので、保留はキャラ単位の1枠やなく会話ごとに持つ。
// キャラ単位の枠は「次に開く会話」だけを指し、旧形式で中に入っとる保留も読めるよう残す。
const activeKey = (characterId: string) => `v2-chat-session:${characterId}`;
const pendingKey = (characterId: string, conversationId: string) =>
  `v2-chat-pending:${characterId}:${conversationId}`;

const EMPTY_SESSION: ChatSession = { version: 1, conversationId: null, pending: null };

const parseStored = <T>(schema: z.ZodType<T>, raw: string | null): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(raw ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const readActive = (characterId: string): ChatSession =>
  parseStored(sessionSchema, localStorage.getItem(activeKey(characterId))) ?? EMPTY_SESSION;

const belongsTo = (
  pending: PendingTurn | null,
  characterId: string,
  conversationId: string,
): pending is PendingTurn =>
  pending !== null &&
  pending.characterId === characterId &&
  pending.conversationId === conversationId;

const readPending = (characterId: string, conversationId: string): PendingTurn | null => {
  const raw = localStorage.getItem(pendingKey(characterId, conversationId));
  if (raw !== null) {
    const stored = parseStored(pendingSchema, raw);
    return belongsTo(stored, characterId, conversationId) ? stored : null;
  }
  const legacy = readActive(characterId).pending;
  return belongsTo(legacy, characterId, conversationId) ? legacy : null;
};

export const readChatSession = (characterId: string, conversationId?: string): ChatSession => {
  if (typeof window === "undefined") return EMPTY_SESSION;
  try {
    const target = conversationId ?? readActive(characterId).conversationId;
    if (!target) return EMPTY_SESSION;
    return { version: 1, conversationId: target, pending: readPending(characterId, target) };
  } catch {
    return EMPTY_SESSION;
  }
};

export const writePendingTurn = (
  characterId: string,
  conversationId: string,
  pending: PendingTurn | null,
): void => {
  if (pending) {
    localStorage.setItem(pendingKey(characterId, conversationId), JSON.stringify(pending));
    return;
  }
  const active = readActive(characterId);
  // 旧形式の枠に残った同じ保留を消さんと、会話ごとの枠が空いた時に読み戻して再送してまう
  if (belongsTo(active.pending, characterId, conversationId)) {
    localStorage.setItem(activeKey(characterId), JSON.stringify({ ...active, pending: null }));
  }
  localStorage.removeItem(pendingKey(characterId, conversationId));
};

export const writeActiveConversation = (characterId: string, conversationId: string): void => {
  const active = readActive(characterId);
  const legacy = active.pending;
  // 旧形式の枠を上書きする前に、中の保留を会話ごとの枠へ移して失わんようにする
  if (
    legacy &&
    belongsTo(legacy, characterId, legacy.conversationId) &&
    localStorage.getItem(pendingKey(characterId, legacy.conversationId)) === null
  ) {
    localStorage.setItem(pendingKey(characterId, legacy.conversationId), JSON.stringify(legacy));
  }
  localStorage.setItem(
    activeKey(characterId),
    JSON.stringify({ version: 1, conversationId, pending: null } satisfies ChatSession),
  );
};

export const writeChatSession = (characterId: string, session: ChatSession): void => {
  if (!session.conversationId) return;
  writePendingTurn(characterId, session.conversationId, session.pending);
  writeActiveConversation(characterId, session.conversationId);
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
