import { and, desc, eq, sql } from "drizzle-orm";

import { selectScopedMemories } from "./memory-scope";
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

// 話しかけの「覚えていること」欄。区切りは RIT-89 FR-4 — 利用者・キャラ・会話・
// 置き換わっていない・今の枝・kind は事実と好みだけ。
export const loadRecentMemories = async (
  db: V2Db,
  scope: { userId: string; characterId: string; conversationId: string },
  limit: number,
): Promise<string[]> =>
  (
    await selectScopedMemories(db, {
      ...scope,
      excludeSuperseded: true,
      activeBranchOnly: true,
      kinds: ["fact", "preference"],
    })
      .orderBy(desc(v2MemoryTable.createdAt))
      .limit(limit)
  ).map((row) => row.v2_memory.content);

// 記念日キュー用の記憶スキャン（FR-4）。区切りは利用者・キャラで会話をまたぐ（未決 1）が、
// 置き換わった・眠った枝・消した記憶・summary は話題に使わん。新しい順。
export const loadRecallCueMemories = async (
  db: V2Db,
  scope: { userId: string; characterId: string },
  limit: number,
): Promise<{ content: string; createdAt: number }[]> =>
  (
    await selectScopedMemories(db, {
      ...scope,
      excludeSuperseded: true,
      activeBranchOnly: true,
      kinds: ["fact", "preference"],
    })
      .orderBy(desc(v2MemoryTable.createdAt))
      .limit(limit)
  ).map((row) => ({
    content: row.v2_memory.content,
    createdAt: row.v2_memory.createdAt,
  }));

// 話しかけは assistant 単独のターンとして保存する。generationId に alarm の冪等キーを残す。
// v2_message は (conversation_id, turn, role) が一意なので、次のターン番号をここで採る。
export const saveProactiveMessage = async (
  db: V2Db,
  input: {
    conversationId: string;
    text: string;
    idempotencyKey: string;
    provider?: string | null;
    upstreamId?: string | null;
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
      provider: input.provider ?? null,
      upstreamId: input.upstreamId ?? null,
      createdAt: input.now,
    }),
    db
      .update(v2ConversationTable)
      .set({ updatedAt: input.now })
      .where(eq(v2ConversationTable.id, input.conversationId)),
  ]);
};
