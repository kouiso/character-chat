// 記憶リセット（RIT-196）。会話（またはキャラの全会話）の記憶3層を全消去する:
// 抽出記憶 v2_memory（+source cascade 分手動削除）・抽出ジョブ v2_memory_job・
// 要約 v2_summary、および Vectorize 上のベクトル。メッセージ本文は消さない。
import { hashMemorySource } from "@v2/db";

import { memoryVectorId, memoryVectorReady, type MemoryVectorBindings } from "./memory-vector";

export type MemoryResetScope = "conversation" | "character";

export interface MemoryResetResult {
  conversations: number;
  memories: number;
  jobs: number;
  summaries: number;
  vectorsDeleted: number;
}

const placeholders = (count: number): string => new Array(count).fill("?").join(",");

// 対象会話 ID 群を解決する。character 指定なら同キャラ・同ユーザーの全会話。
const resolveConversations = async (
  db: D1Database,
  conversationId: string,
  scope: MemoryResetScope,
): Promise<string[]> => {
  if (scope === "conversation") return [conversationId];
  const rows = await db
    .prepare(
      "SELECT c2.id FROM v2_conversation c1 JOIN v2_conversation c2 ON c2.character_id = c1.character_id AND c2.user_id = c1.user_id WHERE c1.id = ?",
    )
    .bind(conversationId)
    .all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
};

// Vectorize 側のベクトルを消す。バインド無し・deleteByIds 未対応なら何もしない。
const deleteMemoryVectors = async (
  env: MemoryVectorBindings,
  memories: { id: string; content: string }[],
): Promise<number> => {
  if (memories.length === 0 || !memoryVectorReady(env) || !env.MEMORY_INDEX.deleteByIds) {
    return 0;
  }
  const vectorIds = await Promise.all(
    memories.map(async (memory) =>
      memoryVectorId(memory.id, await hashMemorySource(memory.content)),
    ),
  );
  await env.MEMORY_INDEX.deleteByIds(vectorIds);
  return vectorIds.length;
};

export const resetConversationMemory = async (
  db: D1Database,
  env: MemoryVectorBindings,
  conversationId: string,
  scope: MemoryResetScope = "conversation",
): Promise<MemoryResetResult> => {
  const ids = await resolveConversations(db, conversationId, scope);
  if (ids.length === 0) {
    return { conversations: 0, memories: 0, jobs: 0, summaries: 0, vectorsDeleted: 0 };
  }
  const marks = placeholders(ids.length);

  // Vectorize のベクトルは行消去より先に ID を計算しておく（content ハッシュが要る）。
  const memoryRows = await db
    .prepare(`SELECT id, content FROM v2_memory WHERE conversation_id IN (${marks})`)
    .bind(...ids)
    .all<{ id: string; content: string }>();
  const memories = memoryRows.results ?? [];
  const vectorsDeleted = await deleteMemoryVectors(env, memories);

  // 関連行を1バッチで消す。source は FK cascade 宣言があるが、D1 の foreign_keys
  // 既定では効かない可能性があるため明示削除する。
  const jobs = await db
    .prepare(`SELECT COUNT(*) AS n FROM v2_memory_job WHERE conversation_id IN (${marks})`)
    .bind(...ids)
    .first<{ n: number }>();
  const summaries = await db
    .prepare(`SELECT COUNT(*) AS n FROM v2_summary WHERE conversation_id IN (${marks})`)
    .bind(...ids)
    .first<{ n: number }>();
  await db.batch([
    db
      .prepare(
        `DELETE FROM v2_memory_source WHERE memory_id IN (SELECT id FROM v2_memory WHERE conversation_id IN (${marks}))`,
      )
      .bind(...ids),
    db.prepare(`DELETE FROM v2_memory WHERE conversation_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM v2_memory_job WHERE conversation_id IN (${marks})`).bind(...ids),
    db.prepare(`DELETE FROM v2_summary WHERE conversation_id IN (${marks})`).bind(...ids),
  ]);
  return {
    conversations: ids.length,
    memories: memories.length,
    jobs: Number(jobs?.n ?? 0),
    summaries: Number(summaries?.n ?? 0),
    vectorsDeleted,
  };
};
