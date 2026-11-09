import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { storedCharacterContentSchema } from "./character-version";
import {
  MEMORY_PUBLISH_ATTEMPTS,
  validateExtractedMemories,
  type ExtractedMemory,
  type ExtractionScope,
} from "./memory-extraction-contract";
import {
  characterRevisionTable,
  characterVersionTable,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";

const unfinished = inArray(v2MemoryJobTable.state, ["pending", "queued"]);

export const listPendingMemoryJobs = async (
  db: V2Db,
  scope: ExtractionScope,
  includeUnindexed = false,
) =>
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
        or(
          eq(v2MemoryJobTable.state, "pending"),
          includeUnindexed
            ? and(
                eq(v2MemoryJobTable.state, "completed"),
                sql`exists (select 1 from v2_memory m join v2_memory_source s on s.memory_id = m.id
            where s.source_message_id = ${v2MemoryJobTable.sourceMessageId} and m.embedding is null)`,
              )
            : undefined,
        ),
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
      state: sql`case when ${v2MemoryJobTable.publishAttempts} + 1 >= ${MEMORY_PUBLISH_ATTEMPTS} then 'failed' else ${v2MemoryJobTable.state} end`,
      errorCode: "queue_delivery_failed",
      updatedAt: Date.now(),
    })
    .where(
      and(
        inArray(v2MemoryJobTable.id, ids),
        inArray(v2MemoryJobTable.state, ["pending", "completed"]),
      ),
    );
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

export type MemoryExtractionPolicy = {
  memoryInstruction: string;
  memoryKinds: ("fact" | "preference")[];
};

const policyFromContent = (contentJson: string): MemoryExtractionPolicy | null => {
  try {
    const parsed = storedCharacterContentSchema.safeParse(JSON.parse(contentJson));
    if (!parsed.success) return null;
    return {
      memoryInstruction: parsed.data.memoryInstruction,
      memoryKinds: parsed.data.memoryKinds,
    };
  } catch {
    return null;
  }
};

// 会話が固定したキャラ版の記憶方針を読む。版未固定の旧会話は最新版に倒す。
// 版の中身が壊れていても抽出自体は止めん（無方針として扱う）。
export const loadMemoryExtractionPolicy = async (
  db: V2Db,
  conversationId: string,
): Promise<MemoryExtractionPolicy | null> => {
  const [pinned] = await db
    .select({ contentJson: characterVersionTable.contentJson })
    .from(v2ConversationTable)
    .innerJoin(
      characterVersionTable,
      eq(characterVersionTable.id, v2ConversationTable.characterVersionId),
    )
    .where(eq(v2ConversationTable.id, conversationId))
    .limit(1);
  if (pinned) return policyFromContent(pinned.contentJson);
  const [latest] = await db
    .select({ contentJson: characterVersionTable.contentJson })
    .from(v2ConversationTable)
    .innerJoin(
      characterRevisionTable,
      eq(characterRevisionTable.characterId, v2ConversationTable.characterId),
    )
    .innerJoin(characterVersionTable, eq(characterVersionTable.id, characterRevisionTable.versionId))
    .where(eq(v2ConversationTable.id, conversationId))
    .orderBy(desc(characterRevisionTable.revision))
    .limit(1);
  return latest ? policyFromContent(latest.contentJson) : null;
};

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
  // 手で消された内容はこの会話では書き戻さん（RIT-94 の tombstone）
  const contentHashes = await Promise.all(
    memories.map((memory) => hashMemorySource(memory.content)),
  );
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
      const notTombstoned = and(
        eligible,
        sql`not exists (select 1 from v2_memory_tombstone t
          where t.conversation_id = ${source.conversationId}
            and t.content_hash = ${contentHashes[ordinal]})`,
      );
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
                // 抽出された記憶は固定しない（手で植えたものだけ 1）
                pinned: sql<number>`0`.as("pinned"),
                sourceTurn: sql<number>`${source.sourceTurn}`.as("source_turn"),
                embedding: sql<Buffer | null>`null`.as("embedding"),
                createdAt: sql<number>`${now}`.as("created_at"),
              })
              .from(v2MemoryJobTable)
              .where(and(eq(v2MemoryJobTable.id, source.id), notTombstoned)),
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
              .where(and(eq(v2MemoryJobTable.id, source.id), notTombstoned)),
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
