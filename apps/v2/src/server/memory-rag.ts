// 実体は packages/engine/src/memory-rag.ts（RIT-99: ベンチでも本番部品を使うため移動）。
// 検索・固定読み出しは失敗の知らせ先として Slack 連携つきの reportFailure を差すため、
// ここで包んで渡す。呼び出し側の引数形は変わらない。
import type { ExtractionScope, V2Db } from "@v2/db";
import {
  indexMemoryJob,
  retrieveMemories as retrieveMemoriesCore,
  retrieveVectorMemories as retrieveVectorMemoriesCore,
  type MemoryVectorBindings,
} from "@v2/engine";

import { reportFailure } from "./log";

import type { MemoryContextEntry } from "@v2/engine";

export { indexMemoryJob };

// 検索箱を通る道だけの検索（埋める → query → 候補読み直し → 順位付け）。固定の道は通らない。
// RIT-78 の verify-memory が「会話の検索で実際に引けるか」を確かめるのに使う。
export const retrieveVectorMemories = (
  db: V2Db,
  env: MemoryVectorBindings,
  scope: ExtractionScope & { beforeTurn?: number; topK?: number },
  query: string,
  now = Date.now(),
): Promise<MemoryContextEntry[]> =>
  retrieveVectorMemoriesCore(db, env, scope, query, now, reportFailure);

export const retrieveMemories = (
  db: V2Db,
  env: MemoryVectorBindings,
  scope: ExtractionScope & { beforeTurn?: number; topK?: number },
  query: string,
  now = Date.now(),
): Promise<MemoryContextEntry[]> => retrieveMemoriesCore(db, env, scope, query, now, reportFailure);
