import { and, desc, eq, sql } from "drizzle-orm";

import { v2ConversationTable, v2MemoryTable, v2MessageTable } from "./v2-schema";

import type { V2Db } from "./client";

// キャラからの話しかけを載せる会話。最新を使い、無ければ受け皿だけ作る。
export const ensureProactiveConversation = async (
  db: V2Db,
  input: { userId: string; characterId: string; promptVersion: string; now: number },
): Promise<string> => {
  const row = await db
    .select({ id: v2ConversationTable.id })
    .from(v2ConversationTable)
    .where(
      and(
        eq(v2ConversationTable.userId, input.userId),
        eq(v2ConversationTable.characterId, input.characterId),
      ),
    )
    .orderBy(desc(v2ConversationTable.updatedAt))
    .limit(1)
    .then((rows) => rows[0]);
  if (row) return row.id;
  const id = crypto.randomUUID();
  await db.insert(v2ConversationTable).values({
    id,
    userId: input.userId,
    characterId: input.characterId,
    threadId: id,
    promptVersion: input.promptVersion,
    createdAt: input.now,
    updatedAt: input.now,
  });
  return id;
};

export const loadRecentMemories = async (
  db: V2Db,
  conversationId: string,
  limit: number,
): Promise<string[]> =>
  (
    await db
      .select({ content: v2MemoryTable.content })
      .from(v2MemoryTable)
      .where(eq(v2MemoryTable.conversationId, conversationId))
      .orderBy(desc(v2MemoryTable.createdAt))
      .limit(limit)
  ).map((row) => row.content);

// 話しかけは assistant 単独のターンとして保存する。generationId に alarm の冪等キーを残す。
// v2_message は (conversation_id, turn, role) が一意なので、次のターン番号をここで採る。
export const saveProactiveMessage = async (
  db: V2Db,
  input: {
    conversationId: string;
    text: string;
    idempotencyKey: string;
    now: number;
  },
): Promise<void> => {
  const maxTurn = await db
    .select({ max: sql<number | null>`max(${v2MessageTable.turn})` })
    .from(v2MessageTable)
    .where(eq(v2MessageTable.conversationId, input.conversationId))
    .then((rows) => rows[0]?.max ?? 0);
  await db.batch([
    db.insert(v2MessageTable).values({
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      turn: (maxTurn ?? 0) + 1,
      role: "assistant",
      content: input.text,
      generationId: input.idempotencyKey,
      createdAt: input.now,
    }),
    db
      .update(v2ConversationTable)
      .set({ updatedAt: input.now })
      .where(eq(v2ConversationTable.id, input.conversationId)),
  ]);
};
