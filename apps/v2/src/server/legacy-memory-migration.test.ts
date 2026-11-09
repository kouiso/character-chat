// RIT-78: 移行実行側の確かめ — memory_note が v2_memory へ移り bge-m3 で
// Vectorize へ索引されること、rag_chunk が別 namespace へ入ること、
// dryRun が何も書かんことを実 D1＋模擬束縛で見る。
// @vitest-environment node
import { v2ConversationTable } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";
import { characterTable } from "../../../../src/schema/character";
import { memoryNoteTable } from "../../../../src/schema/memory-note";
import { ragChunkTable } from "../../../../src/schema/rag-chunk";
import { userTable } from "../../../../src/schema/user";

import { LEGACY_CORPUS_NAMESPACE, runLegacyMemoryMigration } from "./legacy-memory-migration";

const LEGACY_USER = "rit78-app-legacy";
const TARGET_USER = "rit78-app-target";
const NOW = 1794190000000;

const vector = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

const bindings = () => {
  const stored = new Map<string, VectorizeVector>();
  const runMock = vi.fn().mockResolvedValue({ data: [vector] });
  const upsertMock = vi.fn().mockImplementation(async (vectors: VectorizeVector[]) => {
    for (const item of vectors) stored.set(item.id, item);
    return { ids: vectors.map((v) => v.id), count: vectors.length };
  });
  return {
    V2_RAG_ENABLED: "1",
    AI: { run: runMock as unknown as Ai["run"] },
    MEMORY_INDEX: {
      upsert: upsertMock as unknown as VectorizeIndex["upsert"],
      query: vi
        .fn()
        .mockResolvedValue({ count: 0, matches: [] }) as unknown as VectorizeIndex["query"],
    },
    runMock,
    upsertMock,
    stored,
  };
};

describe("runLegacyMemoryMigration", () => {
  let local: LocalD1;
  let charId: string;

  const countMigratedMemories = async () => {
    const row = await local.d1
      .prepare("SELECT COUNT(*) AS n FROM v2_memory WHERE conversation_id = ?")
      .bind("rit78-app-conv")
      .first<{ n: number }>();
    return row?.n ?? 0;
  };

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
      id: "rit78-app-conv",
      userId: TARGET_USER,
      legacySourceUserId: LEGACY_USER,
      characterId: charId,
      title: "",
      threadId: "rit78-app-conv",
      promptVersion: "legacy-import-v1",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await local.db.insert(memoryNoteTable).values({
      id: "rit78-app-note",
      userId: LEGACY_USER,
      characterId: charId,
      content: "紅茶が好き",
      createdAt: NOW,
    });
    await local.db.insert(ragChunkTable).values({
      id: "rit78-app-chunk",
      type: "glossary",
      phase: "conversation",
      characterId: charId,
      text: "用語チャンク",
      embedding: vector,
      createdAt: NOW,
    });
  });

  afterAll(async () => {
    await local.d1.batch([
      local.d1.prepare("DELETE FROM v2_memory WHERE conversation_id = ?").bind("rit78-app-conv"),
      local.d1.prepare("DELETE FROM memory_note WHERE user_id = ?").bind(LEGACY_USER),
      local.d1.prepare("DELETE FROM rag_chunk WHERE id = ?").bind("rit78-app-chunk"),
      local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind("rit78-app-conv"),
      local.d1.prepare("DELETE FROM user WHERE id IN (?, ?)").bind(LEGACY_USER, TARGET_USER),
    ]);
    await local.dispose();
  });

  it("dryRun は D1 も Vectorize も書かず件数だけ返す", async () => {
    const env = bindings();
    const report = await runLegacyMemoryMigration(local.db, env, {
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET_USER,
      dryRun: true,
      corpus: true,
    });
    expect(report.notes.notesTotal).toBe(1);
    expect(report.corpusChunks).toBe(1);
    expect(report.indexed).toBe(0);
    expect(env.upsertMock).not.toHaveBeenCalled();
    expect(await countMigratedMemories()).toBe(0);
  });

  it("note が v2_memory＋Vectorize へ、chunk が legacy-corpus namespace へ入る", async () => {
    const env = bindings();
    const report = await runLegacyMemoryMigration(local.db, env, {
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET_USER,
      corpus: true,
    });
    expect(report.notes.migrated).toBe(1);
    expect(report.indexed).toBe(1);
    expect(report.corpusIndexed).toBe(1);

    const memVector = [...env.stored.values()].find((v) => v.id !== "legacy-rag-rit78-app-chunk");
    expect(memVector?.values).toHaveLength(1024);
    expect(memVector?.metadata).toMatchObject({
      memory_id: "legacy-mn-rit78-app-note",
      kind: "fact",
      conversation_id: "rit78-app-conv",
    });
    const corpus = env.stored.get("legacy-rag-rit78-app-chunk");
    expect(corpus?.namespace).toBe(LEGACY_CORPUS_NAMESPACE);
    expect(corpus?.metadata).toMatchObject({ source: "rag_chunk", type: "glossary" });

    const memRow = await local.d1
      .prepare("SELECT length(embedding) AS bytes FROM v2_memory WHERE id = ?")
      .bind("legacy-mn-rit78-app-note")
      .first<{ bytes: number | null }>();
    expect(memRow?.bytes).toBe(1024 * 4);

    // 冪等 — 2回目は onConflictDoNothing で D1 行は増えん。
    const before = await countMigratedMemories();
    await runLegacyMemoryMigration(local.db, bindings(), {
      sourceUserId: LEGACY_USER,
      targetUserId: TARGET_USER,
    });
    expect(await countMigratedMemories()).toBe(before);
  });
});
