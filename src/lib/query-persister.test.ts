import { afterEach, describe, expect, it, vi } from "vitest";

import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

type QueryCacheEntry = {
  id: string;
  payload: PersistedClient;
  updatedAt: number;
  buster: string;
};

type QueryCacheTable = {
  put: (entry: QueryCacheEntry) => Promise<void>;
  get: (id: string) => Promise<QueryCacheEntry | undefined>;
  delete: (id: string) => Promise<void>;
};

type QueryPersisterModule = {
  queryPersister: Persister;
};

const testClient: PersistedClient = {
  timestamp: 1_704_000_000_000,
  buster: "test",
  clientState: {
    mutations: [],
    queries: [],
  },
};

const createMemoryTable = (): QueryCacheTable => {
  const entries = new Map<string, QueryCacheEntry>();
  return {
    put: async (entry) => {
      entries.set(entry.id, entry);
    },
    get: async (id) => entries.get(id),
    delete: async (id) => {
      entries.delete(id);
    },
  };
};

const importPersisterWithThrowingDexie = async (): Promise<QueryPersisterModule> => {
  vi.resetModules();
  vi.doMock("dexie", () => ({
    default: class ThrowingDexie {
      constructor() {
        throw new Error("SecurityError");
      }
    },
  }));
  return import("./query-persister");
};

const importPersisterWithMemoryDexie = async (): Promise<QueryPersisterModule> => {
  vi.resetModules();
  const queryCache = createMemoryTable();
  vi.doMock("dexie", () => ({
    default: class MemoryDexie {
      queryCache = queryCache;

      version() {
        return {
          stores: () => {
            this.queryCache = queryCache;
          },
        };
      }
    },
  }));
  return import("./query-persister");
};

describe("queryPersister", () => {
  afterEach(() => {
    vi.doUnmock("dexie");
    vi.resetModules();
  });

  it("IndexedDB が利用不可でも persistClient は throw しない", async () => {
    const { queryPersister } = await importPersisterWithThrowingDexie();
    await expect(queryPersister.persistClient(testClient)).resolves.toBeUndefined();
  });

  it("IndexedDB が利用不可なら restoreClient は undefined を返す", async () => {
    const { queryPersister } = await importPersisterWithThrowingDexie();
    await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
  });

  it("IndexedDB が利用不可でも removeClient は throw しない", async () => {
    const { queryPersister } = await importPersisterWithThrowingDexie();
    await expect(queryPersister.removeClient()).resolves.toBeUndefined();
  });

  it("persistClient で保存した client を restoreClient で復元する", async () => {
    const { queryPersister } = await importPersisterWithMemoryDexie();
    await queryPersister.persistClient(testClient);
    await expect(queryPersister.restoreClient()).resolves.toEqual(testClient);
  });

  it("期限切れ cache は削除して undefined を返す", async () => {
    const { queryPersister } = await importPersisterWithMemoryDexie();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(24 * 60 * 60 * 1000 + 1);

    await queryPersister.persistClient(testClient);

    await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
    await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
  });

  it("removeClient は保存済み cache を削除する", async () => {
    const { queryPersister } = await importPersisterWithMemoryDexie();

    await queryPersister.persistClient(testClient);
    await queryPersister.removeClient();

    await expect(queryPersister.restoreClient()).resolves.toBeUndefined();
  });
});
