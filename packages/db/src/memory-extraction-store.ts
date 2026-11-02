import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  MEMORY_PUBLISH_ATTEMPTS,
  validateExtractedMemories,
  type ExtractedMemory,
  type ExtractionScope,
} from "./memory-extraction-contract";
import {
  v2ConversationTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";

const unfinished = inArray(v2MemoryJobTable.state, ["pending", "queued"]);

export const listPendingMemoryJobs = async (db: V2Db, scope: ExtractionScope) =>
  db
    .select({ id: v2MemoryJobTable.id })
    .from(v2MemoryJobTable)
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryJobTable.conversationId))
    .where(
      and(
        eq(v2MemoryJobTable.conversationId, scope.conversationId),
        eq(v2MemoryJobTable.userId, scope.userId),
        eq(v2MemoryJobTable.characterId, scope.characterId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        eq(v2MemoryJobTable.state, "pending"),
      ),
    )
    .orderBy(asc(v2MemoryJobTable.createdAt), asc(v2MemoryJobTable.id))
    .limit(20);

export const markMemoryJobsQueued = async (db: V2Db, ids: string[]) => {
  if (ids.length === 0) return;
  await db
    .update(v2MemoryJobTable)
    .set({ state: "queued", updatedAt: Date.now(), errorCode: null })
    .where(and(inArray(v2MemoryJobTable.id, ids), eq(v2MemoryJobTable.state, "pending")));
};

export const markMemoryPublishFailure = async (db: V2Db, ids: string[]) => {
  if (ids.length === 0) return;
  await db
    .update(v2MemoryJobTable)
    .set({
      publishAttempts: sql`${v2MemoryJobTable.publishAttempts} + 1`,
      state: sql`case when ${v2MemoryJobTable.publishAttempts} + 1 >= ${MEMORY_PUBLISH_ATTEMPTS} then 'failed' else 'pending' end`,
      errorCode: "queue_delivery_failed",
      updatedAt: Date.now(),
    })
    .where(and(inArray(v2MemoryJobTable.id, ids), eq(v2MemoryJobTable.state, "pending")));
};

export const loadMemoryExtractionSource = async (db: V2Db, id: string) => {
  const [source] = await db
    .select({
      id: v2MemoryJobTable.id,
      conversationId: v2MemoryJobTable.conversationId,
      userId: v2MemoryJobTable.userId,
      characterId: v2MemoryJobTable.characterId,
      sourceMessageId: v2MemoryJobTable.sourceMessageId,
      sourceTurn: v2MemoryJobTable.sourceTurn,
      content: v2MessageTable.content,
      createdAt: v2MessageTable.createdAt,
    })
    .from(v2MemoryJobTable)
    .innerJoin(v2MessageTable, eq(v2MessageTable.id, v2MemoryJobTable.sourceMessageId))
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryJobTable.conversationId))
    .where(
      and(
        eq(v2MemoryJobTable.id, id),
        unfinished,
        eq(v2MessageTable.role, "user"),
        eq(v2MessageTable.conversationId, v2MemoryJobTable.conversationId),
        eq(v2MessageTable.turn, v2MemoryJobTable.sourceTurn),
        eq(v2ConversationTable.userId, v2MemoryJobTable.userId),
        eq(v2ConversationTable.characterId, v2MemoryJobTable.characterId),
      ),
    )
    .limit(1);
  return source ?? null;
};

export type MemoryExtractionSource = NonNullable<
  Awaited<ReturnType<typeof loadMemoryExtractionSource>>
>;

export const hashMemorySource = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const completeMemoryExtraction = async (
  db: V2Db,
  source: MemoryExtractionSource,
  extracted: ExtractedMemory[],
): Promise<void> => {
  const memories = validateExtractedMemories({ memories: extracted }, source.content);
  const hash = await hashMemorySource(source.content);
  const now = Date.now();
  // 推論中に元発言や所有者が変わった場合も、書込と同じトランザクション内で止める。
  const eligible = sql`exists (
    select 1 from v2_memory_job j
    join v2_message m on m.id = j.source_message_id
    join v2_conversation c on c.id = j.conversation_id
    where j.id = ${source.id} and j.state in ('pending', 'queued')
      and j.source_message_id = ${source.sourceMessageId}
      and j.conversation_id = ${source.conversationId}
      and j.user_id = ${source.userId} and j.character_id = ${source.characterId}
      and m.role = 'user' and m.content = ${source.content}
      and m.conversation_id = j.conversation_id and m.turn = j.source_turn
      and c.user_id = j.user_id and c.character_id = j.character_id
  )`;
  await db.batch([
    db
      .update(v2MemoryJobTable)
      .set({ updatedAt: now })
      .where(and(eq(v2MemoryJobTable.id, source.id), eligible)),
    ...memories.flatMap((memory, ordinal) => {
      const id = `${source.id}:${ordinal}`;
      return [
        db
          .insert(v2MemoryTable)
          .select(
            db
              .select({
                id: sql<string>`${id}`.as("id"),
                conversationId: sql<string>`${source.conversationId}`.as("conversation_id"),
                kind: sql<"fact" | "preference">`${memory.kind}`.as("kind"),
                content: sql<string>`${memory.content}`.as("content"),
                sourceTurn: sql<number>`${source.sourceTurn}`.as("source_turn"),
                embedding: sql<Buffer | null>`null`.as("embedding"),
                createdAt: sql<number>`${now}`.as("created_at"),
              })
              .from(v2MemoryJobTable)
              .where(and(eq(v2MemoryJobTable.id, source.id), eligible)),
          )
          .onConflictDoNothing(),
        db
          .insert(v2MemorySourceTable)
          .select(
            db
              .select({
                memoryId: sql<string>`${id}`.as("memory_id"),
                sourceMessageId: sql<string>`${source.sourceMessageId}`.as("source_message_id"),
                sourceContentHash: sql<string>`${hash}`.as("source_content_hash"),
                importance: sql<number>`${memory.importance}`.as("importance"),
                validFrom: sql<string | null>`${memory.validFrom}`.as("valid_from"),
                validUntil: sql<string | null>`${memory.validUntil}`.as("valid_until"),
              })
              .from(v2MemoryJobTable)
              .where(and(eq(v2MemoryJobTable.id, source.id), eligible)),
          )
          .onConflictDoNothing(),
      ];
    }),
    db
      .update(v2MemoryJobTable)
      .set({ state: "completed", errorCode: null, updatedAt: now })
      .where(and(eq(v2MemoryJobTable.id, source.id), eligible)),
    db
      .update(v2MemoryJobTable)
      .set({ state: "failed", errorCode: "source_changed", updatedAt: now })
      .where(and(eq(v2MemoryJobTable.id, source.id), unfinished)),
  ]);
};

export const failMemoryExtraction = async (db: V2Db, id: string): Promise<void> => {
  await db
    .update(v2MemoryJobTable)
    .set({ state: "failed", errorCode: "extraction_failed", updatedAt: Date.now() })
    .where(and(eq(v2MemoryJobTable.id, id), unfinished));
};
