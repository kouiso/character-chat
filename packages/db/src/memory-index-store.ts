import { and, eq, inArray, isNull, lt, sql, type SQLWrapper } from "drizzle-orm";

import { MEMORY_INDEX_ATTEMPTS } from "./memory-extraction-contract";
import { memoryReadConditions } from "./memory-scope";
import {
  v2ConversationTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";
import type { ExtractionScope } from "./memory-extraction-contract";

// Vectorize の topK 上限（RIT-84 NFR-2）。D1 1 文の引数上限 100 にも収まる。
export const MEMORY_QUERY_TOPK_MAX = 50;

const sourceQuery = (db: V2Db) =>
  db
    .select({
      id: v2MemoryTable.id,
      conversationId: v2MemoryTable.conversationId,
      kind: v2MemoryTable.kind,
      content: v2MemoryTable.content,
      createdAt: v2MemoryTable.createdAt,
      embedding: v2MemoryTable.embedding,
      sourceMessageId: v2MemorySourceTable.sourceMessageId,
      sourceContentHash: v2MemorySourceTable.sourceContentHash,
      sourceContent: v2MessageTable.content,
      importance: v2MemorySourceTable.importance,
      validFrom: v2MemorySourceTable.validFrom,
      validUntil: v2MemorySourceTable.validUntil,
      userId: v2ConversationTable.userId,
      characterId: v2ConversationTable.characterId,
    })
    .from(v2MemoryTable)
    .innerJoin(v2MemorySourceTable, eq(v2MemorySourceTable.memoryId, v2MemoryTable.id))
    .innerJoin(v2MessageTable, eq(v2MessageTable.id, v2MemorySourceTable.sourceMessageId))
    .innerJoin(v2ConversationTable, eq(v2ConversationTable.id, v2MemoryTable.conversationId));

const sourceMatches = and(
  eq(v2MessageTable.role, "user"),
  eq(v2MessageTable.conversationId, v2MemoryTable.conversationId),
  eq(v2MessageTable.turn, v2MemoryTable.sourceTurn),
);

export const loadUnindexedMemoryJob = async (db: V2Db, jobId: string) => {
  const [job] = await db
    .select()
    .from(v2MemoryJobTable)
    .where(and(eq(v2MemoryJobTable.id, jobId), eq(v2MemoryJobTable.state, "completed")))
    .limit(1);
  if (!job) return [];
  return sourceQuery(db)
    .where(
      and(
        sourceMatches,
        // 区切りは RIT-89 の読み手条件へ集約（利用者・キャラ・会話・枝・論理削除）。
        // 眠った枝の出どころを持つ記憶は検索にも出ないので索引へ載せん（FR-8）。
        memoryReadConditions({
          userId: job.userId,
          characterId: job.characterId,
          conversationId: job.conversationId,
          excludeSuperseded: false,
          activeBranchOnly: true,
        }),
        eq(v2MemorySourceTable.sourceMessageId, job.sourceMessageId),
        isNull(v2MemoryTable.embedding),
      ),
    )
    .limit(8);
};

export type IndexableMemory = Awaited<ReturnType<typeof loadUnindexedMemoryJob>>[number];

export const loadMemoryCandidates = async (
  db: V2Db,
  scope: ExtractionScope & { beforeTurn?: number; kinds?: ("fact" | "preference" | "summary")[] },
  ids: string[],
) => {
  if (ids.length === 0) return [];
  return sourceQuery(db)
    .where(
      and(
        sourceMatches,
        // 検索箱が別区切りの候補を返しても D1 側の区切りで捨てる（RIT-89 FR-6）。
        // 置き換わった記憶は指示文へ出さん（RIT-86）・眠った枝の記憶も出さん（FR-2）・
        // 指示文へ入るのは事実と好みだけ（summary は検索側の filter と同じ区切り）。
        memoryReadConditions({
          ...scope,
          excludeSuperseded: true,
          activeBranchOnly: true,
          kinds: ["fact", "preference"],
        }),
        inArray(v2MemoryTable.id, ids.slice(0, MEMORY_QUERY_TOPK_MAX)),
        scope.beforeTurn === undefined ? undefined : lt(v2MemoryTable.sourceTurn, scope.beforeTurn),
        scope.kinds === undefined ? undefined : inArray(v2MemoryTable.kind, scope.kinds),
      ),
    )
    .limit(MEMORY_QUERY_TOPK_MAX);
};

export const saveMemoryEmbedding = async (db: V2Db, memory: IndexableMemory, vector: number[]) => {
  // 外部indexへの書込み中に元発言や記憶が変わっても、旧版を完了扱いにしない。
  const embedding = new Uint8Array(new Float32Array(vector).buffer);
  await db
    .update(v2MemoryTable)
    .set({ embedding: sql<Buffer>`${embedding}` })
    .where(
      and(
        eq(v2MemoryTable.id, memory.id),
        eq(v2MemoryTable.content, memory.content),
        eq(v2MemoryTable.conversationId, memory.conversationId),
        sql`exists (select 1 from v2_memory_source s
        join v2_message m on m.id = s.source_message_id
        join v2_conversation c on c.id = m.conversation_id
        where s.memory_id = ${memory.id} and s.source_message_id = ${memory.sourceMessageId}
          and s.source_content_hash = ${memory.sourceContentHash} and m.content = ${memory.sourceContent}
          and c.id = ${memory.conversationId} and c.user_id = ${memory.userId}
          and c.character_id = ${memory.characterId})`,
      ),
    );
};

// 索引の失敗 1 回ごとの勘定（RIT-74 FR-5）。state は completed のままにする — failed にすると
// listPendingMemoryJobs が二度と拾わず、その記憶は永久に索引に入らん。失敗回数が上限に
// 届いた時か、Queue の配りが最後（terminal）の時に error_code='index_failed' を付けて送りを止める。
export const failMemoryIndex = async (db: V2Db, jobId: string, terminal = false) => {
  await db
    .update(v2MemoryJobTable)
    .set({
      indexAttempts: sql`${v2MemoryJobTable.indexAttempts} + 1`,
      errorCode: terminal
        ? "index_failed"
        : sql`case when ${v2MemoryJobTable.indexAttempts} + 1 >= ${MEMORY_INDEX_ATTEMPTS} then 'index_failed' else ${v2MemoryJobTable.errorCode} end`,
      updatedAt: Date.now(),
    })
    .where(and(eq(v2MemoryJobTable.id, jobId), eq(v2MemoryJobTable.state, "completed")));
};

// 対象の会話は利用者の物だけ（所有境界は v2_conversation.user_id）。
const ownedConversation = (userId: string, column: SQLWrapper) =>
  sql`exists (select 1 from v2_conversation c where c.id = ${column} and c.user_id = ${userId})`;

// mode: "failed" — index_failed の job を未完成へ戻し、次の送りで拾わせる（RIT-74 FR-6）。
export const resetFailedMemoryIndex = async (
  db: V2Db,
  userId: string,
  conversationId?: string,
): Promise<number> => {
  const result = await db
    .update(v2MemoryJobTable)
    .set({ indexAttempts: 0, errorCode: null, state: "completed", updatedAt: Date.now() })
    .where(
      and(
        eq(v2MemoryJobTable.errorCode, "index_failed"),
        ownedConversation(userId, v2MemoryJobTable.conversationId),
        conversationId === undefined
          ? undefined
          : eq(v2MemoryJobTable.conversationId, conversationId),
      ),
    );
  return result.meta.changes ?? 0;
};

// mode: "all" — metadata index を後から作った時の入れ直し（RIT-74 FR-8）。
// 索引より先に upsert されたベクトルは絞り込みに効かんので、embedding を null に戻して
// 次の送りで同じ vector id で upsert し直させる（件数は増えん）。
export const resetAllMemoryIndex = async (
  db: V2Db,
  userId: string,
  conversationId?: string,
): Promise<number> => {
  const [, jobs] = await db.batch([
    db
      .update(v2MemoryTable)
      .set({ embedding: null })
      .where(
        and(
          inArray(v2MemoryTable.kind, ["fact", "preference"]),
          ownedConversation(userId, v2MemoryTable.conversationId),
          conversationId === undefined
            ? undefined
            : eq(v2MemoryTable.conversationId, conversationId),
        ),
      ),
    db
      .update(v2MemoryJobTable)
      .set({ indexAttempts: 0, errorCode: null, state: "completed", updatedAt: Date.now() })
      .where(
        and(
          ownedConversation(userId, v2MemoryJobTable.conversationId),
          conversationId === undefined
            ? undefined
            : eq(v2MemoryJobTable.conversationId, conversationId),
          // 記憶を持つ job だけを戻す（未抽出の pending/queued には記憶が無いので自然に除ける）。
          sql`exists (select 1 from v2_memory_source s join v2_memory m on m.id = s.memory_id
            where s.source_message_id = ${v2MemoryJobTable.sourceMessageId}
              and m.conversation_id = ${v2MemoryJobTable.conversationId}
              and m.kind in ('fact', 'preference'))`,
        ),
      ),
  ]);
  return jobs.meta.changes ?? 0;
};
