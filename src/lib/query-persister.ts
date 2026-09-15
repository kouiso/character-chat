import Dexie, { type EntityTable } from "dexie";

import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

const QUERY_CACHE_ENTRY_ID = "react-query-cache";
// キャッシュ有効期限: 24時間。古いキャッシュには期限切れR2 URLが含まれる可能性があるため破棄する。
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
// バスター: デプロイ後に古いキャッシュ構造を自動破棄するために更新する。
const CACHE_BUSTER = "v2";

interface QueryCacheEntry {
  id: string;
  payload: PersistedClient;
  updatedAt: number;
  buster: string;
}

class QueryCacheDatabase extends Dexie {
  queryCache!: EntityTable<QueryCacheEntry, "id">;

  constructor() {
    super("ai-chat-query-cache");
    this.version(1).stores({
      queryCache: "id, updatedAt",
    });
  }
}

// iOS Safari private mode / storage-blocked environments throw SecurityError on open.
// Instantiate lazily and fall back to a no-op persister on failure.
let queryCacheDatabaseInstance: QueryCacheDatabase | null = null;

const getDatabase = (): QueryCacheDatabase | null => {
  if (queryCacheDatabaseInstance) return queryCacheDatabaseInstance;
  try {
    queryCacheDatabaseInstance = new QueryCacheDatabase();
    return queryCacheDatabaseInstance;
  } catch {
    return null;
  }
};

export const queryPersister: Persister = {
  persistClient: async (client) => {
    const db = getDatabase();
    if (!db) return;
    try {
      await db.queryCache.put({
        id: QUERY_CACHE_ENTRY_ID,
        payload: client,
        updatedAt: Date.now(),
        buster: CACHE_BUSTER,
      });
    } catch {
      // iOS private mode / QuotaExceededError: サイレントフォールバック
    }
  },
  restoreClient: async () => {
    const db = getDatabase();
    if (!db) return undefined;
    try {
      const cached = await db.queryCache.get(QUERY_CACHE_ENTRY_ID);
      if (!cached) return undefined;
      if (cached.buster !== CACHE_BUSTER) {
        await db.queryCache.delete(QUERY_CACHE_ENTRY_ID).catch(() => undefined);
        return undefined;
      }
      if (Date.now() - cached.updatedAt > MAX_CACHE_AGE_MS) {
        await db.queryCache.delete(QUERY_CACHE_ENTRY_ID).catch(() => undefined);
        return undefined;
      }
      return cached.payload;
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    const db = getDatabase();
    if (!db) return;
    try {
      await db.queryCache.delete(QUERY_CACHE_ENTRY_ID);
    } catch {
      // サイレントフォールバック
    }
  },
};
