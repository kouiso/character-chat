import { and, asc, desc, eq, exists, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { storedCharacterContentSchema } from "./character-version";
import { recomputeSupersessionStatements } from "./memory-supersession";
import {
  MEMORY_INDEX_ATTEMPTS,
  MEMORY_PUBLISH_ATTEMPTS,
  validateExtractedMemories,
  type ExtractedMemory,
  type ExtractionScope,
} from "./memory-extraction-contract";
import { joinedSourceOnActiveBranch, selectScopedMemories } from "./memory-scope";
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
                // index_failed（5 回到達）は運用の口で戻すまで拾わん（RIT-74）
                lt(v2MemoryJobTable.indexAttempts, MEMORY_INDEX_ATTEMPTS),
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(v2MemoryTable)
                    .innerJoin(
                      v2MemorySourceTable,
                      eq(v2MemorySourceTable.memoryId, v2MemoryTable.id),
                    )
                    .innerJoin(
                      v2MessageTable,
                      eq(v2MessageTable.id, v2MemorySourceTable.sourceMessageId),
                    )
                    .where(
                      and(
                        eq(v2MemorySourceTable.sourceMessageId, v2MemoryJobTable.sourceMessageId),
                        isNull(v2MemoryTable.embedding),
                        // 論理削除済みの未索引行は埋め込みを再配送せん（RIT-94）
                        isNull(v2MemoryTable.deletedAt),
                        // 眠った枝の未索引記憶を拾い続けると publishMemories が alarm を
                        // 予約し直して Queue へ送り続ける（RIT-89 FR-8）
                        joinedSourceOnActiveBranch,
                      ),
                    ),
                ),
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
    .innerJoin(
      characterVersionTable,
      eq(characterVersionTable.id, characterRevisionTable.versionId),
    )
    .where(eq(v2ConversationTable.id, conversationId))
    .orderBy(desc(characterRevisionTable.revision))
    .limit(1);
  return latest ? policyFromContent(latest.contentJson) : null;
};

// 抜き出しへ渡す主題一覧の上限（RIT-73 FR-5）。会話ごとに覚える話題は
// 多くても数十なので、直近 50 件で指示文の膨張を抑える。
export const ACTIVE_SUBJECT_LIMIT = 50;

// 同じ会話で今有効な記憶の主題一覧（RIT-73 FR-5）。新しい順・重複なし。
// 区切りは RIT-89 — 利用者・キャラ・会話・置き換わっていない・今の枝（抜き出しの
// 指示文へ眠った枝の話題を混ぜると、戻った話を覚え続ける事になる）。消した記憶
// （deleted）は「有効」でないので区切り側で除く — 消した話題の主題へ新しい記憶を
// 寄せると復活に見える。
export const listActiveSubjects = async (db: V2Db, scope: ExtractionScope): Promise<string[]> => {
  const rows = await selectScopedMemories(
    db,
    { ...scope, excludeSuperseded: true, activeBranchOnly: true },
    [ne(v2MemoryTable.subject, "")],
  )
    .groupBy(v2MemoryTable.subject)
    .orderBy(desc(sql`max(${v2MemoryTable.createdAt})`))
    .limit(ACTIVE_SUBJECT_LIMIT);
  return rows.map((row) => row.v2_memory.subject);
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
                subject: sql<string>`${memory.subject}`.as("subject"),
                supersededBy: sql<string | null>`null`.as("superseded_by"),
                deletedAt: sql<number | null>`null`.as("deleted_at"),
                revision: sql<number>`1`.as("revision"),
                category: sql<"long" | "recent" | "relation" | "future">`${memory.category}`.as(
                  "category",
                ),
                origin: sql<"extracted">`'extracted'`.as("origin"),
                editedAt: sql<number | null>`null`.as("edited_at"),
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
    // 同じ主題の記憶は新しい方が勝つ（RIT-86）。届いた順ではなく source_turn → id の順で
    // 主題ごとに並べ直すので、Queue のやり直しで古い発言が後から届いても古い値に戻らん。
    // 記憶の insert の後・job の完了より前に入れる — 同じ batch なので失敗時は job が
    // Queue のやり直しに回り、記憶だけ保存されて置き換えが抜ける状態にはならん。
    ...recomputeSupersessionStatements(
      db,
      source.conversationId,
      memories.map((memory) => memory.subject),
    ),
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
    .set({
      state: "failed",
      errorCode: "extraction_failed",
      updatedAt: Date.now(),
    })
    .where(and(eq(v2MemoryJobTable.id, id), unfinished));
};
