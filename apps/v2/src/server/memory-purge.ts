// 記憶の物理削除と検索箱の点の除去（RIT-94）。論理削除から 30 秒の復元窓を
// 過ぎた行を消す掃除は、会話の記憶 API と Queue 受け手の両方の始めに走らせる。
import {
  describeError,
  hashMemorySource,
  loadExpiredMemories,
  MEMORY_RESTORE_WINDOW_MS,
  removeMemories,
  type MemoryScope,
  type V2Db,
} from "@v2/db";

import { reportFailure } from "./log";
import { memoryVectorId, memoryVectorReady, type MemoryVectorBindings } from "./memory-vector";

// 検索箱の点を消す。失敗しても呼び出し側の処理は止めん — 読む道が D1 で確かめるので
// 残った点は使われん（FR-9）。失敗は memory_vector_drop_failed を 1 行残す。
export const dropMemoryVector = async (
  env: MemoryVectorBindings,
  memoryId: string,
  content: string,
): Promise<void> => {
  if (!memoryVectorReady(env)) return;
  try {
    const hash = await hashMemorySource(content);
    await env.MEMORY_INDEX.deleteByIds?.([await memoryVectorId(memoryId, hash)]);
  } catch (error) {
    reportFailure(env, {
      event: "memory_vector_drop_failed",
      level: "error",
      reason: describeError(error),
    });
  }
};

// 復元窓を過ぎた論理削除行を物理削除する。検索箱の点もここで消し直す
// （削除時の点消しが失敗しとってもここで拾える）。戻り値は消した行数。
export const purgeExpiredMemories = async (
  db: V2Db,
  env: MemoryVectorBindings,
  filter: { conversationId: string } | MemoryScope,
  now = Date.now(),
): Promise<number> => {
  const expired = await loadExpiredMemories(db, filter, now - MEMORY_RESTORE_WINDOW_MS);
  if (expired.length === 0) return 0;
  for (const row of expired) {
    await dropMemoryVector(env, row.id, row.content);
  }
  await removeMemories(
    db,
    expired.map((row) => row.id),
  );
  return expired.length;
};
