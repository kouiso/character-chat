// @vitest-environment node
// RIT-77: POST /api/admin/legacy-migration — mode 3 種・400/404/405/409/415・
// 応答に本文・題・利用者 ID が無い・apply を省くと D1 の行数が変わらない。
// apps/v2 側では drizzle-orm の記号を直接 import しない（@v2/db と二重バージョンで
// 型が衝突する）。種まきと掃除は @v2/db の createDb か生 SQL で行う。
import {
  characterTable,
  conversationTable,
  legacyOwnerLabel,
  messageTable,
  userTable,
} from "@v2/db";
import type { createDb } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  FRESH_LOCAL_D1_TIMEOUT_MS,
  openLocalD1,
  type LocalD1,
} from "../../../../packages/db/src/test/local-d1";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: platform.env }) }));

const { handleLegacyMigration } = await import("./api-admin-migration");

const post = (body: unknown, contentType = "application/json") =>
  handleLegacyMigration(
    new Request("https://v2.test/api/admin/legacy-migration", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/admin/legacy-migration", () => {
  let local: LocalD1;
  let db: ReturnType<typeof createDb>;
  const owner = `api-migration-${crypto.randomUUID()}`;
  // 会話 ID は本物と同じく利用者 ID を含まない乱数（応答に ID が混ざらん事を確かめるため）。
  const conversationId = `conv-${crypto.randomUUID()}`;
  let sourceOwner = "";

  beforeAll(async () => {
    local = await openLocalD1();
    db = local.db;
    platform.env = { DB: local.d1 };
    const [character] = await db.select({ id: characterTable.id }).from(characterTable).limit(1);
    await db
      .insert(userTable)
      .values({ id: owner, email: `${owner}@example.invalid`, createdAt: 1 });
    await db.insert(conversationTable).values({
      id: conversationId,
      userId: owner,
      characterId: character.id,
      title: "題名は出さない",
      createdAt: 1,
      updatedAt: 1,
    });
    for (const [index, role] of ["user", "assistant"].entries()) {
      await db.insert(messageTable).values({
        id: `${conversationId}-m${index}`,
        conversationId,
        userId: owner,
        characterId: character.id,
        role: role as "user" | "assistant",
        content: "本文は出さない",
        createdAt: index + 1,
      });
    }
    sourceOwner = await legacyOwnerLabel(owner);
  }, FRESH_LOCAL_D1_TIMEOUT_MS);
  afterAll(async () => {
    // 掃除は生 SQL で（drizzle の述語は @v2/db 側の型を通せんので）。
    for (const [sql, id] of [
      ["DELETE FROM v2_message WHERE conversation_id = ?", conversationId],
      ["DELETE FROM v2_legacy_import WHERE conversation_id = ?", conversationId],
      ["DELETE FROM v2_conversation WHERE id = ?", conversationId],
      ["DELETE FROM message WHERE user_id = ?", owner],
      ["DELETE FROM conversation WHERE user_id = ?", owner],
      ["DELETE FROM user WHERE id = ?", owner],
    ] as const) {
      await local.d1.prepare(sql).bind(id).run();
    }
    platform.env = {};
    await local.dispose();
  });

  it("POST 以外は 405、JSON でなければ 415、形が違えば 400", async () => {
    const get = await handleLegacyMigration(
      new Request("https://v2.test/api/admin/legacy-migration", { method: "GET" }),
    );
    expect(get.status).toBe(405);
    const notJson = await post({ mode: "sources" }, "text/plain");
    expect(notJson.status).toBe(415);
    expect(await notJson.json()).toEqual({ code: "content_type_required" });
    const broken = await handleLegacyMigration(
      new Request("https://v2.test/api/admin/legacy-migration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(broken.status).toBe(400);
  });

  it("mode が足りん・知らん・古い項目を含むと 400 bad_request", async () => {
    for (const body of [
      {},
      // memory・verify-memory は札が要るので札抜きは 400。corpus・verify-corpus は札無しで通る。
      { mode: "memory" },
      { mode: "verify-memory" },
      { mode: "conversations" },
      { mode: "conversations", sourceOwner, dryRun: true },
      { mode: "conversations", sourceOwner, sourceUserId: "x" },
      { mode: "conversations", sourceOwner, limit: 21 },
      { mode: "conversations", sourceOwner: "notalabel" },
      { mode: "conversations", sourceOwner, apply: true },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ code: "bad_request" });
    }
  });

  it("当たる利用者の無い札は 404 source_not_found", async () => {
    const response = await post({ mode: "conversations", sourceOwner: "owner-00000000" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "source_not_found" });
  });

  it("sources は札と件数だけ返し、利用者 ID を出さない", async () => {
    const response = await post({ mode: "sources" });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      sources: {
        sourceOwner: string;
        conversations: number;
        messages: number;
        importedConversations: number;
      }[];
    };
    const row = json.sources.find((entry) => entry.sourceOwner === sourceOwner);
    expect(row).toEqual({
      sourceOwner,
      conversations: 1,
      messages: 2,
      importedConversations: 0,
    });
    expect(JSON.stringify(json)).not.toContain(owner);
  });

  it("確認だけは書き込まず、応答に本文・題・利用者 ID が無い", async () => {
    const before = await local.d1
      .prepare("SELECT count(*) AS n FROM v2_message")
      .first<{ n: number }>();
    const response = await post({ mode: "conversations", sourceOwner });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      mode: "conversations",
      apply: false,
      sourceOwner,
      nextCursor: null,
      page: {
        conversations: 1,
        messages: 2,
        insertedConversations: 1,
        insertedMessages: 2,
        failures: [],
      },
    });
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain("題名は出さない");
    expect(serialized).not.toContain("本文は出さない");
    const after = await local.d1
      .prepare("SELECT count(*) AS n FROM v2_message")
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("apply: true は expected と一致する時だけ書き、ずれれば 409 plan_changed", async () => {
    const mismatched = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 1, insertedMessages: 1 },
    });
    expect(mismatched.status).toBe(409);
    expect(await mismatched.json()).toEqual({
      code: "plan_changed",
      planned: { insertedConversations: 1, insertedMessages: 2 },
    });
    const applied = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 1, insertedMessages: 2 },
    });
    expect(applied.status).toBe(200);
    const json = (await applied.json()) as {
      page: { insertedConversations: number; insertedMessages: number };
    };
    expect(json.page).toMatchObject({ insertedConversations: 1, insertedMessages: 2 });
    // 2 度目は 0。expected が 0・0 でなければ 409。
    const again = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 0, insertedMessages: 0 },
    });
    expect(again.status).toBe(200);
    const stale = await post({
      mode: "conversations",
      sourceOwner,
      apply: true,
      expected: { insertedConversations: 1, insertedMessages: 2 },
    });
    expect(stale.status).toBe(409);
  });

  it("verify-conversations は 1 件ずつの状態を返し、何も書かない", async () => {
    const response = await post({ mode: "verify-conversations", sourceOwner });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      mode: string;
      sourceOwner: string;
      nextCursor: string | null;
      page: { items: { conversationId: string; status: string; matchedMessages: number }[] };
    };
    expect(json).toMatchObject({ mode: "verify-conversations", sourceOwner, nextCursor: null });
    expect(json.page.items[0]).toMatchObject({
      conversationId,
      status: "match",
      matchedMessages: 2,
    });
    expect(JSON.stringify(json)).not.toContain(owner);
  });
});

// RIT-78: memory・corpus・verify-memory・verify-corpus。
// 検索箱と Workers AI は偽物で埋める（実バインディングは wrangler 外に無い）。
type FakeVector = {
  id: string;
  namespace?: string;
  values: number[];
  metadata?: Record<string, unknown>;
};

const fakeEmbedding = (text: string): number[] => {
  const values = Array.from({ length: 1024 }, () => 0);
  for (const [i, ch] of [...text].entries()) values[(ch.charCodeAt(0) * 7 + i) % 1024] += 1;
  return values;
};

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [i, x] of a.entries()) {
    dot += x * (b[i] ?? 0);
    na += x * x;
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const fakeIndex = () => {
  const store = new Map<string, FakeVector>();
  return {
    store,
    upsert: async (vectors: FakeVector[]) => {
      for (const v of vectors) store.set(v.id, v);
      return { ids: vectors.map((v) => v.id), count: vectors.length };
    },
    query: async (
      values: number[],
      opts: {
        namespace?: string;
        topK?: number;
        filter?: Record<string, unknown>;
      },
    ) => {
      const matchFilter = (metadata: Record<string, unknown> | undefined) =>
        Object.entries(opts.filter ?? {}).every(([key, cond]) => {
          const value = metadata?.[key];
          if (cond !== null && typeof cond === "object" && "$in" in cond) {
            return (cond as { $in: unknown[] }).$in.includes(value);
          }
          return value === cond;
        });
      const matches = [...store.values()]
        .filter((v) => v.namespace === opts.namespace && matchFilter(v.metadata))
        .map((v) => ({ id: v.id, score: cosine(values, v.values), metadata: v.metadata }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.topK ?? 5);
      return { matches, count: matches.length };
    },
    getByIds: async (ids: string[]) => ids.flatMap((id) => (store.has(id) ? [store.get(id)!] : [])),
    deleteByIds: async (ids: string[]) => {
      for (const id of ids) store.delete(id);
      return { ids, count: ids.length };
    },
  };
};

const fakeAi = {
  run: async (_model: string, input: { text: string[] }) => ({
    data: input.text.map((t) => fakeEmbedding(t)),
  }),
};

describe("POST /api/admin/legacy-migration (RIT-78)", () => {
  let local: LocalD1;
  const owner = `rit78api-${crypto.randomUUID()}`;
  // 応答は旧 id を返すので、id には利用者 ID を混ぜない（出さん物の検査が自分自身で壊れんよう）。
  const noteId = (n: string) => `rit78api-note-${n}`;
  const chunkId = (n: string) => `rit78api-chunk-${n}`;
  const convId = `rit78api-v2c-${crypto.randomUUID()}`;
  const msgId = `rit78api-v2m-${crypto.randomUUID()}`;
  let characterId = "";
  let sourceOwner = "";
  let index: ReturnType<typeof fakeIndex>;

  const enableVector = () => {
    platform.env = {
      DB: local.d1,
      V2_RAG_ENABLED: "1",
      AI: fakeAi,
      MEMORY_INDEX: index,
    };
  };
  const disableVector = () => {
    platform.env = { DB: local.d1, V2_RAG_ENABLED: "0", AI: fakeAi, MEMORY_INDEX: index };
  };

  beforeAll(async () => {
    local = await openLocalD1();
    index = fakeIndex();
    platform.env = { DB: local.d1 };
    const [character] = await local.db
      .select({ id: characterTable.id })
      .from(characterTable)
      .limit(1);
    characterId = character.id;
    await local.db
      .insert(userTable)
      .values({ id: owner, email: `${owner}@example.invalid`, createdAt: 1 });
    // 移行先の会話と自分の発言（v2 側）。
    await local.d1.batch([
      local.d1
        .prepare(
          "INSERT INTO v2_conversation (id, user_id, legacy_source_user_id, character_id, title, thread_id, prompt_version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(convId, "local", owner, characterId, "", convId, "legacy-import-v1", 1, 1),
      local.d1
        .prepare(
          "INSERT INTO v2_message (id, conversation_id, turn, role, content, created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(msgId, convId, 1, "user", "元の発言", 2),
    ]);
    // 旧記憶メモと検索の塊（旧側）。
    for (const [n, content] of [
      ["a", "記憶 A"],
      ["b", "記憶 B"],
    ] as const) {
      await local.d1
        .prepare(
          "INSERT INTO memory_note (id, user_id, character_id, content, created_at) VALUES (?,?,?,?,?)",
        )
        .bind(noteId(n), owner, characterId, content, 1)
        .run();
    }
    for (const [n, type, phase, charId, text] of [
      ["1", "glossary", "conversation", null, "用語の説明"],
      ["2", "exemplar", "conversation", null, "例文"],
    ] as const) {
      await local.d1
        .prepare(
          "INSERT INTO rag_chunk (id, type, phase, character_id, text, embedding, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(chunkId(n), type, phase, charId, text, new Uint8Array(new Float32Array(8).buffer), 1)
        .run();
    }
    sourceOwner = await legacyOwnerLabel(owner);
  }, FRESH_LOCAL_D1_TIMEOUT_MS);

  afterAll(async () => {
    for (const sql of [
      "DELETE FROM v2_memory_source WHERE memory_id LIKE 'legacy-mn-rit78api-%'",
      "DELETE FROM v2_memory WHERE id LIKE 'legacy-mn-rit78api-%'",
      "DELETE FROM v2_legacy_import WHERE legacy_id LIKE 'rit78api-%'",
      "DELETE FROM v2_message WHERE id LIKE 'rit78api-%'",
      "DELETE FROM v2_conversation WHERE id LIKE 'rit78api-%'",
      "DELETE FROM memory_note WHERE id LIKE 'rit78api-%'",
      "DELETE FROM rag_chunk WHERE id LIKE 'rit78api-%'",
      "DELETE FROM user WHERE id LIKE 'rit78api-%'",
    ]) {
      await local.d1.prepare(sql).run();
    }
    platform.env = {};
    await local.dispose();
  });

  it("memory: apply は expected が要り、無ければ 400・ずれれば 409", async () => {
    // expected ずれは 503 より後に起きるので、検査には検索箱が要る。
    enableVector();
    const noExpected = await post({ mode: "memory", sourceOwner, apply: true });
    expect(noExpected.status).toBe(400);
    const inspect = await post({ mode: "memory", sourceOwner });
    expect(inspect.status).toBe(200);
    const inspectJson = (await inspect.json()) as { page: { insertedMemories: number } };
    expect(inspectJson.page.insertedMemories).toBe(2);
    const stale = await post({
      mode: "memory",
      sourceOwner,
      apply: true,
      expected: { insertedMemories: 99 },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      code: "plan_changed",
      planned: { insertedMemories: 2 },
    });
    const count = await local.d1
      .prepare("SELECT count(*) AS n FROM v2_memory WHERE id LIKE 'legacy-mn-rit78api-%'")
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("memory: 知らない札は 404、検索箱が使えなければ apply は 503", async () => {
    const missing = await post({ mode: "memory", sourceOwner: "owner-00000000" });
    expect(missing.status).toBe(404);
    disableVector();
    const unavailable = await post({
      mode: "memory",
      sourceOwner,
      apply: true,
      expected: { insertedMemories: 2 },
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ code: "vector_unavailable" });
  });

  it("memory: apply は 3 行と索引を作り、2 度目は 0 件", async () => {
    enableVector();
    const first = await post({
      mode: "memory",
      sourceOwner,
      apply: true,
      expected: { insertedMemories: 2 },
    });
    expect(first.status).toBe(200);
    const json = (await first.json()) as {
      page: {
        insertedMemories: number;
        indexedMemories: number;
        failures: { noteId: string; code: string }[];
      };
    };
    expect(json.page.insertedMemories).toBe(2);
    expect(json.page.indexedMemories).toBe(2);
    expect(json.page.failures).toEqual([]);
    const rows = await local.d1
      .prepare(
        "SELECT id, conversation_id, content, pinned, source_turn, embedding FROM v2_memory WHERE id LIKE 'legacy-mn-rit78api-%'",
      )
      .all<{
        id: string;
        conversation_id: string;
        pinned: number;
        source_turn: number;
        embedding: unknown;
      }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results?.every((r) => r.conversation_id === convId)).toBe(true);
    expect(
      rows.results?.every((r) => r.pinned === 0 && r.source_turn === 1 && r.embedding !== null),
    ).toBe(true);
    // 索引: 2 つの記憶ベクトルが持ち主×キャラの区画に入る。
    const memoryVectors = [...index.store.values()].filter(
      (v) =>
        typeof v.metadata?.memory_id === "string" && v.metadata.memory_id.startsWith("legacy-mn-"),
    );
    expect(memoryVectors).toHaveLength(2);
    // 応答に本文・利用者 ID は無い。
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain("記憶 A");

    const second = await post({
      mode: "memory",
      sourceOwner,
      apply: true,
      expected: { insertedMemories: 0 },
    });
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as { page: { insertedMemories: number } };
    expect(secondJson.page.insertedMemories).toBe(0);
  });

  it("verify-memory: match は retrievable を返し、点が消えれば偽になる", async () => {
    enableVector();
    const verify = await post({ mode: "verify-memory", sourceOwner, search: true });
    expect(verify.status).toBe(200);
    const json = (await verify.json()) as {
      page: { items: { noteId: string; status: string; retrievable?: boolean }[] };
    };
    expect(json.page.items).toHaveLength(2);
    for (const item of json.page.items) {
      expect(item.status).toBe("match");
      expect(item.retrievable).toBe(true);
    }
    // 片方の点を消すと、検索箱を通る道では引けなくなる（retrievable: false）。
    const victim = [...index.store.values()].find(
      (v) => v.metadata?.memory_id === `legacy-mn-${noteId("a")}`,
    );
    if (!victim) throw new Error("vector for note a missing in fake index");
    index.store.delete(victim.id);
    const again = await post({ mode: "verify-memory", sourceOwner, search: true });
    const againJson = (await again.json()) as {
      page: { items: { noteId: string; status: string; retrievable?: boolean }[] };
    };
    const byId = new Map(againJson.page.items.map((i) => [i.noteId, i.retrievable]));
    expect(byId.get(noteId("a"))).toBe(false);
    expect(byId.get(noteId("b"))).toBe(true);
    // 応答に本文・利用者 ID は無い。
    const serialized = JSON.stringify(againJson);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain("記憶 A");
  });

  it("verify-memory: search で 10 件を越える limit は 400、検索箱が無ければ 503", async () => {
    enableVector();
    const tooMany = await post({ mode: "verify-memory", sourceOwner, search: true, limit: 11 });
    expect(tooMany.status).toBe(400);
    disableVector();
    const unavailable = await post({ mode: "verify-memory", sourceOwner, search: true });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ code: "vector_unavailable" });
    // 検索を付けなければ検索箱無しでも状態だけは返る。
    const statuses = await post({ mode: "verify-memory", sourceOwner });
    expect(statuses.status).toBe(200);
  });

  it("corpus: apply は expected が要り、無ければ 400・検索箱が無ければ 503・ずれれば 409", async () => {
    const noExpected = await post({ mode: "corpus", apply: true });
    expect(noExpected.status).toBe(400);
    disableVector();
    const unavailable = await post({
      mode: "corpus",
      apply: true,
      expected: { chunks: 2 },
    });
    expect(unavailable.status).toBe(503);
    enableVector();
    const stale = await post({ mode: "corpus", apply: true, expected: { chunks: 99 } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ code: "plan_changed", planned: { chunks: 2 } });
  });

  it("corpus: 塊を legacy-corpus 区画へ legacy-rag-<id> で入れ、繰り返しても増えない", async () => {
    enableVector();
    const inspect = await post({ mode: "corpus" });
    expect(((await inspect.json()) as { page: { chunks: number } }).page.chunks).toBe(2);
    const applied = await post({ mode: "corpus", apply: true, expected: { chunks: 2 } });
    expect(applied.status).toBe(200);
    const json = (await applied.json()) as { page: { chunks: number; indexed: number } };
    expect(json.page).toMatchObject({ chunks: 2, indexed: 2 });
    const corpusVectors = [...index.store.values()].filter((v) => v.namespace === "legacy-corpus");
    expect(corpusVectors.map((v) => v.id).sort()).toEqual([
      `legacy-rag-${chunkId("1")}`,
      `legacy-rag-${chunkId("2")}`,
    ]);
    expect(corpusVectors.every((v) => v.metadata?.source === "rag_chunk")).toBe(true);
    // 会話メモの区画には入らない（応答の検索には現れん）。
    expect(corpusVectors.every((v) => v.metadata?.memory_id === undefined)).toBe(true);
    // 2 度目も同じ id へ入れ直すので件数は増えない。
    const again = await post({ mode: "corpus", apply: true, expected: { chunks: 2 } });
    expect(again.status).toBe(200);
    expect([...index.store.values()].filter((v) => v.namespace === "legacy-corpus")).toHaveLength(
      2,
    );
    // 応答に本文は無い。
    expect(JSON.stringify(json)).not.toContain("用語の説明");
  });

  it("verify-corpus: 検索箱にある点を数え、無い id を missingIds に返す", async () => {
    enableVector();
    const all = await post({ mode: "verify-corpus" });
    expect(all.status).toBe(200);
    const allJson = (await all.json()) as {
      page: { chunks: number; present: number; missingIds: string[] };
    };
    expect(allJson.page).toEqual({ chunks: 2, present: 2, missingIds: [] });
    index.store.delete(`legacy-rag-${chunkId("1")}`);
    const partial = await post({ mode: "verify-corpus" });
    const partialJson = (await partial.json()) as {
      page: { chunks: number; present: number; missingIds: string[] };
    };
    expect(partialJson.page).toEqual({
      chunks: 2,
      present: 1,
      missingIds: [`legacy-rag-${chunkId("1")}`],
    });
    disableVector();
    const unavailable = await post({ mode: "verify-corpus" });
    expect(unavailable.status).toBe(503);
  });
});
