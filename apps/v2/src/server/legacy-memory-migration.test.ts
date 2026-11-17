// RIT-78: 移行の実行側 — 1 件ずつ埋める → Vectorize へ入れる → embedding を D1 へ書き戻す。
// 途中の失敗は index_failed にして続く事、rag_chunk が legacy-corpus 区画へ入る事、
// 検索箱が使えない時は 503 に化ける例外を投げる事を実 D1＋模擬束縛で見る。
// @vitest-environment node
import { v2ConversationTable } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { characterTable } from "../../../../src/schema/character";
import { ragChunkTable } from "../../../../src/schema/rag-chunk";
import { userTable } from "../../../../src/schema/user";

import {
  indexMemoryTargets,
  LEGACY_CORPUS_NAMESPACE,
  MemoryVectorUnavailableError,
  runLegacyCorpusPage,
  verifyLegacyCorpusPage,
} from "./legacy-memory-migration";

const LEGACY_USER = "rit78-app-legacy";
const TARGET_USER = "rit78-app-target";
const CONV = "rit78-app-conv";
const NOW = 1794190000000;

const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

// 本文に "壊れる" を含む物だけ埋め込みを失敗させる（部分失敗の検査用）。
const bindings = (opts: { getByIds?: boolean } = {}) => {
  const stored = new Map<string, VectorizeVector>();
  const runMock = vi.fn().mockImplementation(async (_model: string, input: { text: string[] }) => {
    if (input.text[0].includes("壊れる")) throw new Error("embedding failed");
    return { data: [vector] };
  });
  const upsertMock = vi.fn().mockImplementation(async (vectors: VectorizeVector[]) => {
    for (const item of vectors) stored.set(item.id, item);
    return { ids: vectors.map((v) => v.id), count: vectors.length };
  });
  const getByIdsMock = vi.fn().mockImplementation(async (ids: string[]) =>
    ids.flatMap((id) => {
      const hit = stored.get(id);
      return hit ? [{ id, values: hit.values }] : [];
    }),
  );
  return {
    V2_RAG_ENABLED: "1",
    AI: { run: runMock as unknown as Ai["run"] },
    MEMORY_INDEX: {
      upsert: upsertMock as unknown as VectorizeIndex["upsert"],
      query: vi
        .fn()
        .mockResolvedValue({ count: 0, matches: [] }) as unknown as VectorizeIndex["query"],
      ...(opts.getByIds === false
        ? {}
        : { getByIds: getByIdsMock as unknown as VectorizeIndex["getByIds"] }),
    },
    runMock,
    upsertMock,
    stored,
  };
};

const insertMemory = async (local: LocalD1, id: string, content: string) => {
  await local.d1
    .prepare(
      "INSERT INTO v2_memory (id, conversation_id, kind, content, pinned, source_turn, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(id, CONV, "fact", content, 0, 1, NOW)
    .run();
};

describe("indexMemoryTargets / runLegacyCorpusPage / verifyLegacyCorpusPage", () => {
  let local: LocalD1;
  let charId: string;

  beforeAll(async () => {
    local = await openLocalD1();
    const chars = await local.db.select({ id: characterTable.id }).from(characterTable).limit(1);
    charId = chars[0].id;
    await local.db
      .insert(userTable)
      .values([
        { id: LEGACY_USER, email: `${LEGACY_USER}@test`, createdAt: NOW },
        { id: TARGET_USER, email: `${TARGET_USER}@test`, createdAt: NOW },
      ])
      .onConflictDoNothing();
    await local.db.insert(v2ConversationTable).values({
      id: CONV,
      userId: TARGET_USER,
      legacySourceUserId: LEGACY_USER,
      characterId: charId,
      title: "",
      threadId: CONV,
      promptVersion: "legacy-import-v1",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await local.db
      .insert(ragChunkTable)
      .values([
        {
          id: "rit78-app-chunk-a",
          type: "glossary",
          phase: "conversation",
          characterId: charId,
          text: "用語チャンク",
          embedding: vector,
          createdAt: NOW,
        },
        {
          id: "rit78-app-chunk-b",
          type: "exemplar",
          phase: "climax",
          characterId: null,
          text: "例文チャンク",
          embedding: vector,
          createdAt: NOW,
        },
        {
          id: "rit78-app-chunk-bad",
          type: "glossary",
          phase: "conversation",
          characterId: null,
          text: "壊れるチャンク",
          embedding: vector,
          createdAt: NOW,
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1.prepare("DELETE FROM v2_memory WHERE conversation_id = ?").bind(CONV),
      local.d1.prepare("DELETE FROM rag_chunk WHERE id LIKE 'rit78-app-%'"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind(CONV),
      local.d1.prepare("DELETE FROM user WHERE id IN (?, ?)").bind(LEGACY_USER, TARGET_USER),
    ]);
    await local.dispose();
  });

  it("1 件ずつ埋める → Vectorize へ入れる → embedding を D1 へ書き戻す（FR-5）", async () => {
    await insertMemory(local, "rit78-app-m1", "紅茶が好き");
    const env = bindings();
    const result = await indexMemoryTargets(local.db, env, TARGET_USER, [
      {
        noteId: "rit78-app-note1",
        memoryId: "rit78-app-m1",
        conversationId: CONV,
        characterId: charId,
        kind: "fact",
        content: "紅茶が好き",
      },
    ]);
    expect(result).toEqual({ indexed: 1, failures: [] });
    expect(env.upsertMock).toHaveBeenCalledTimes(1);
    const storedVector = [...env.stored.values()][0];
    expect(storedVector.metadata).toMatchObject({
      memory_id: "rit78-app-m1",
      kind: "fact",
      conversation_id: CONV,
    });
    const row = await local.d1
      .prepare("SELECT length(embedding) AS bytes FROM v2_memory WHERE id = ?")
      .bind("rit78-app-m1")
      .first<{ bytes: number | null }>();
    expect(row?.bytes).toBe(1024 * 4);
  });

  it("埋め込みに失敗した 1 件だけ index_failed にして次へ進む", async () => {
    await insertMemory(local, "rit78-app-m2", "壊れる記憶");
    await insertMemory(local, "rit78-app-m3", "大丈夫な記憶");
    const env = bindings();
    const result = await indexMemoryTargets(local.db, env, TARGET_USER, [
      {
        noteId: "rit78-app-note2",
        memoryId: "rit78-app-m2",
        conversationId: CONV,
        characterId: charId,
        kind: "fact",
        content: "壊れる記憶",
      },
      {
        noteId: "rit78-app-note3",
        memoryId: "rit78-app-m3",
        conversationId: CONV,
        characterId: charId,
        kind: "fact",
        content: "大丈夫な記憶",
      },
    ]);
    expect(result.indexed).toBe(1);
    expect(result.failures).toEqual([{ noteId: "rit78-app-note2", code: "index_failed" }]);
    // 失敗した方の D1 行は残る（次の実行で埋め直せる）。
    const kept = await local.d1
      .prepare("SELECT embedding IS NULL AS noemb FROM v2_memory WHERE id = ?")
      .bind("rit78-app-m2")
      .first<{ noemb: number }>();
    expect(kept?.noemb).toBe(1);
  });

  it("検索箱が使えない時は MemoryVectorUnavailableError（受け口は 503）", async () => {
    await insertMemory(local, "rit78-app-m4", "埋めたい記憶");
    const env = { ...bindings(), V2_RAG_ENABLED: "0" };
    await expect(
      indexMemoryTargets(local.db, env, TARGET_USER, [
        {
          noteId: "rit78-app-note4",
          memoryId: "rit78-app-m4",
          conversationId: CONV,
          characterId: charId,
          kind: "fact",
          content: "埋めたい記憶",
        },
      ]),
    ).rejects.toThrow(MemoryVectorUnavailableError);
  });

  it("corpus: 確認だけは件数だけ返し、apply は legacy-corpus 区画へ legacy-rag-<id> で入れる（FR-10/FR-11）", async () => {
    // このテストの塊だけに絞る（種まきされた他の塊が在っても混ざらんよう）。
    const dry = await runLegacyCorpusPage(local.db, bindings(), {
      limit: 2,
      cursor: "rit78-app-",
    });
    expect(dry.chunks).toBe(2);
    expect(dry.indexed).toBe(0);
    expect(dry.nextCursor).toBe("rit78-app-chunk-b");

    const env = bindings();
    const applied = await runLegacyCorpusPage(local.db, env, {
      apply: true,
      limit: 10,
      cursor: "rit78-app-",
      expected: { chunks: 3 },
    });
    // chunk-bad は埋め込みが失敗するので index_failed。他 2 件は入る。
    expect(applied.indexed).toBe(2);
    expect(applied.failures).toEqual([{ chunkId: "rit78-app-chunk-bad", code: "index_failed" }]);
    const a = env.stored.get("legacy-rag-rit78-app-chunk-a");
    const b = env.stored.get("legacy-rag-rit78-app-chunk-b");
    expect(a?.namespace).toBe(LEGACY_CORPUS_NAMESPACE);
    expect(a?.metadata).toMatchObject({
      source: "rag_chunk",
      type: "glossary",
      character_id: charId,
    });
    expect(b?.metadata).toMatchObject({ source: "rag_chunk", type: "exemplar" });
    expect(b?.metadata?.character_id).toBeUndefined();
    // 会話メモの区画には入らない。
    expect(a?.metadata?.memory_id).toBeUndefined();
    // 繰り返しても id が同じなので件数は増えない。
    const again = await runLegacyCorpusPage(local.db, env, {
      apply: true,
      limit: 10,
      cursor: "rit78-app-",
      expected: { chunks: 3 },
    });
    expect(again.indexed).toBe(2);
    expect(
      [...env.stored.values()].filter((v) => v.namespace === LEGACY_CORPUS_NAMESPACE),
    ).toHaveLength(2);
  });

  it("corpus: expected とページ件数が違えば LegacyCorpusPlanChangedError で何も入れない", async () => {
    const env = bindings();
    await expect(
      runLegacyCorpusPage(local.db, env, {
        apply: true,
        limit: 10,
        cursor: "rit78-app-",
        expected: { chunks: 99 },
      }),
    ).rejects.toThrow("確認だけで見た件数と計画が変わっている");
    expect(env.upsertMock).not.toHaveBeenCalled();
  });

  it("corpus: 検索箱が使えなければ apply は MemoryVectorUnavailableError", async () => {
    const env = { ...bindings(), V2_RAG_ENABLED: "0" };
    await expect(
      runLegacyCorpusPage(local.db, env, {
        apply: true,
        limit: 10,
        cursor: "rit78-app-",
        expected: { chunks: 3 },
      }),
    ).rejects.toThrow(MemoryVectorUnavailableError);
  });

  it("verify-corpus: 在る点を数え、無い id を missingIds に返す", async () => {
    const env = bindings();
    await env.MEMORY_INDEX.upsert([
      { id: "legacy-rag-rit78-app-chunk-a", namespace: LEGACY_CORPUS_NAMESPACE, values: vector },
    ]);
    const result = await verifyLegacyCorpusPage(local.db, env, {
      limit: 10,
      cursor: "rit78-app-",
    });
    expect(result.chunks).toBe(3);
    expect(result.present).toBe(1);
    expect(result.missingIds).toEqual([
      "legacy-rag-rit78-app-chunk-b",
      "legacy-rag-rit78-app-chunk-bad",
    ]);
  });

  it("verify-corpus: getByIds の無い束縛や検索箱が無い時は MemoryVectorUnavailableError", async () => {
    await expect(
      verifyLegacyCorpusPage(local.db, bindings({ getByIds: false }), { limit: 10 }),
    ).rejects.toThrow(MemoryVectorUnavailableError);
    const disabled = { ...bindings(), V2_RAG_ENABLED: "0" };
    await expect(verifyLegacyCorpusPage(local.db, disabled, { limit: 10 })).rejects.toThrow(
      MemoryVectorUnavailableError,
    );
  });
});
