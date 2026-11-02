import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import {
  v2ConversationTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MemoryTable,
  v2MessageTable,
} from "./v2-schema";

import type { V2Db } from "./client";
import type { ExtractionScope } from "./memory-extraction-contract";

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
        eq(v2MemorySourceTable.sourceMessageId, job.sourceMessageId),
        eq(v2MemoryTable.conversationId, job.conversationId),
        eq(v2ConversationTable.userId, job.userId),
        eq(v2ConversationTable.characterId, job.characterId),
        isNull(v2MemoryTable.embedding),
      ),
    )
    .limit(8);
};

export type IndexableMemory = Awaited<ReturnType<typeof loadUnindexedMemoryJob>>[number];

export const loadMemoryCandidates = async (
  db: V2Db,
  scope: ExtractionScope & { beforeTurn?: number },
  ids: string[],
) => {
  if (ids.length === 0) return [];
  return sourceQuery(db)
    .where(
      and(
        sourceMatches,
        eq(v2MemoryTable.conversationId, scope.conversationId),
        eq(v2ConversationTable.userId, scope.userId),
        eq(v2ConversationTable.characterId, scope.characterId),
        inArray(v2MemoryTable.id, ids.slice(0, 20)),
        scope.beforeTurn === undefined ? undefined : lt(v2MemoryTable.sourceTurn, scope.beforeTurn),
      ),
    )
    .limit(20);
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
        isNotNull(v2MemoryTable.sourceTurn),
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

export const failMemoryIndex = async (db: V2Db, jobId: string) => {
  await db
    .update(v2MemoryJobTable)
    .set({ state: "failed", errorCode: "index_failed", updatedAt: Date.now() })
    .where(and(eq(v2MemoryJobTable.id, jobId), eq(v2MemoryJobTable.state, "completed")));
};
