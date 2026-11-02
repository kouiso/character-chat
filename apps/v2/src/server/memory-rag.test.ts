// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterTable,
  completeMemoryExtraction,
  hashMemorySource,
  listPendingMemoryJobs,
  loadMemoryExtractionSource,
  userTable,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MessageTable,
  type ExtractedMemory,
} from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { consumeMemoryJobs } from "./memory-queue";
import { indexMemoryJob, retrieveMemories } from "./memory-rag";
import { memoryNamespace, memoryVectorId } from "./memory-vector";

const owner = `rag-${crypto.randomUUID()}`;
const characterIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
const conversationIds: string[] = [];
const now = Date.now();
const preference: ExtractedMemory = {
  kind: "preference",
  content: "紅茶が好き",
  importance: 3,
  validFrom: null,
  validUntil: null,
};
const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));

const bindings = () => {
  const stored = new Map<string, VectorizeVector>();
  const runMock = vi.fn().mockResolvedValue({ data: [vector] });
  const run = runMock as unknown as Ai["run"];
  const upsertMock = vi.fn().mockImplementation(async (vectors: VectorizeVector[]) => {
    for (const item of vectors) stored.set(item.id, item);
    return { ids: vectors.map((item) => item.id), count: vectors.length };
  });
  const upsert = upsertMock as unknown as VectorizeIndex["upsert"];
  // index側が境界を誤って返してもD1で拒否するため、ここではfilterを適用しない。
  const queryMock = vi.fn().mockImplementation(async () => ({
    count: stored.size,
    matches: [...stored.values()].map(({ id, metadata, namespace }) => ({
      id,
      metadata,
      namespace,
      score: 0.9,
    })),
  }));
  const query = queryMock as unknown as VectorizeIndex["query"];
  return {
    V2_RAG_ENABLED: "1",
    AI: { run },
    MEMORY_INDEX: { upsert, query },
    runMock,
    upsertMock,
    queryMock,
    stored,
  };
};

describe("memory RAG with local D1", () => {
  let local: LocalD1;
  let persistRoot: string | undefined;
  const templateCharacterId = crypto.randomUUID();

  const seed = async (
    memories = [preference],
    userId = owner,
    characterId: string = characterIds[0],
  ) => {
    const conversationId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    conversationIds.push(conversationId);
    const content = memories
      .map((memory) =>
        [memory.content, memory.validFrom, memory.validUntil].filter(Boolean).join(" "),
      )
      .join("。 ");
    await local.db.batch([
      local.db.insert(v2ConversationTable).values({
        id: conversationId,
        userId,
        characterId,
        threadId: conversationId,
        promptVersion: "test",
        createdAt: now,
        updatedAt: now,
      }),
      local.db.insert(v2MessageTable).values({
        id: jobId,
        conversationId,
        turn: 3,
        role: "user",
        content,
        createdAt: now,
      }),
      local.db.insert(v2MemoryJobTable).values({
        id: jobId,
        sourceMessageId: jobId,
        sourceTurn: 3,
        conversationId,
        userId,
        characterId,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const source = await loadMemoryExtractionSource(local.db, jobId);
    if (!source) throw new Error("Missing fixture source");
    await completeMemoryExtraction(local.db, source, memories);
    return { scope: { conversationId, userId, characterId }, jobId, memoryId: `${jobId}:0` };
  };

  beforeAll(async () => {
    persistRoot = await mkdtemp(join(tmpdir(), "v2-memory-rag-"));
    local = await openLocalD1({ persistRoot });
    await local.db.insert(userTable).values({
      id: owner,
      email: `${owner}@example.invalid`,
      createdAt: now,
    });
    const template = {
      id: templateCharacterId,
      userId: owner,
      name: "案内役",
      systemPrompt: "テスト用の案内役です。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: now,
    };
    await local.db.insert(characterTable).values(template);
    await local.db
      .insert(characterTable)
      .values(characterIds.map((id) => ({ ...template, id, name: "案内役" })));
  }, 120_000);

  afterAll(async () => {
    if (!local) return;
    if (conversationIds.length) {
      const placeholders = conversationIds.map(() => "?").join(", ");
      await local.d1
        .prepare(`DELETE FROM v2_memory WHERE conversation_id IN (${placeholders})`)
        .bind(...conversationIds)
        .run();
      await local.d1
        .prepare(`DELETE FROM v2_message WHERE conversation_id IN (${placeholders})`)
        .bind(...conversationIds)
        .run();
      await local.d1
        .prepare(`DELETE FROM v2_conversation WHERE id IN (${placeholders})`)
        .bind(...conversationIds)
        .run();
    }
    await local.d1
      .prepare("DELETE FROM character WHERE id IN (?, ?)")
      .bind(...characterIds)
      .run();
    await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(templateCharacterId).run();
    await local.d1.prepare("DELETE FROM user WHERE id = ?").bind(owner).run();
    await local.dispose();
    if (persistRoot) await rm(persistRoot, { recursive: true, force: true });
  });

  it("保存からindexへつなぎ、再配送で重ねて埋め込まず、D1の本文を取得する", async () => {
    const fixture = await seed();
    const env = bindings();
    expect(await listPendingMemoryJobs(local.db, fixture.scope, true)).toHaveLength(1);
    await indexMemoryJob(local.db, env, fixture.jobId);
    await indexMemoryJob(local.db, env, fixture.jobId);
    expect(env.runMock).toHaveBeenCalledTimes(1);
    expect(env.upsertMock).toHaveBeenCalledTimes(1);
    expect(await listPendingMemoryJobs(local.db, fixture.scope, true)).toEqual([]);
    const hash = await hashMemorySource(preference.content);
    expect([...env.stored.values()][0]).toMatchObject({
      id: await memoryVectorId(fixture.memoryId, hash),
      namespace: await memoryNamespace(fixture.scope),
      metadata: {
        memory_id: fixture.memoryId,
        content_hash: hash,
        kind: "preference",
        conversation_id: fixture.scope.conversationId,
      },
    });
    expect(await retrieveMemories(local.db, env, fixture.scope, "好きな飲み物は？", now)).toEqual([
      { id: fixture.memoryId, content: preference.content },
    ]);
    expect(env.queryMock).toHaveBeenCalledWith(
      vector,
      expect.objectContaining({
        namespace: await memoryNamespace(fixture.scope),
        filter: {
          conversation_id: fixture.scope.conversationId,
          kind: { $in: ["fact", "preference"] },
        },
      }),
    );
  });

  it("同名の別キャラ・同じ話題の別会話・別利用者・未来ターンを混ぜない", async () => {
    const own = await seed();
    const env = bindings();
    for (const fixture of [
      own,
      await seed(),
      await seed([preference], "other-owner"),
      await seed([preference], owner, characterIds[1]),
    ]) {
      await indexMemoryJob(local.db, env, fixture.jobId);
    }
    expect(await retrieveMemories(local.db, env, own.scope, "飲み物", now)).toEqual([
      { id: own.memoryId, content: preference.content },
    ]);
    expect(
      await retrieveMemories(local.db, env, { ...own.scope, userId: "unknown" }, "飲み物", now),
    ).toEqual([]);
    expect(
      await retrieveMemories(local.db, env, { ...own.scope, beforeTurn: 3 }, "飲み物", now),
    ).toEqual([]);
    expect(
      await retrieveMemories(local.db, env, { ...own.scope, beforeTurn: 4 }, "飲み物", now),
    ).toHaveLength(1);
  });

  it("古いindexが残っても、削除・編集・元発言の変更済み記憶を返さない", async () => {
    for (const mode of ["delete", "edit", "source"] as const) {
      const fixture = await seed();
      const env = bindings();
      await indexMemoryJob(local.db, env, fixture.jobId);
      if (mode === "delete")
        await local.d1.prepare("DELETE FROM v2_memory WHERE id = ?").bind(fixture.memoryId).run();
      if (mode === "edit")
        await local.d1
          .prepare("UPDATE v2_memory SET content = ?, embedding = NULL WHERE id = ?")
          .bind("珈琲が好き", fixture.memoryId)
          .run();
      if (mode === "source")
        await local.d1
          .prepare("UPDATE v2_message SET content = ? WHERE id = ?")
          .bind("飲み物の話はしていません。", fixture.jobId)
          .run();
      expect(env.stored.size).toBe(1);
      expect(await retrieveMemories(local.db, env, fixture.scope, "好きな飲み物", now)).toEqual([]);
    }
  });

  it("有効期間で除外し、重要度と新しさを近さに掛けて並べる", async () => {
    const fixture = await seed([
      { ...preference, importance: 1 },
      { ...preference, content: "緑茶も好き", importance: 5 },
      { ...preference, content: "来年は麦茶", validFrom: "2099-01-01" },
      { ...preference, content: "昔は珈琲", validUntil: "2000-01-01" },
    ]);
    const env = bindings();
    await indexMemoryJob(local.db, env, fixture.jobId);
    const greenId = `${fixture.jobId}:1`;
    expect(
      (await retrieveMemories(local.db, env, fixture.scope, "好み", now)).map((item) => item.id),
    ).toEqual([greenId, fixture.memoryId]);
    await local.d1
      .prepare("UPDATE v2_memory SET created_at = ? WHERE id = ?")
      .bind(now - 120 * 86_400_000, greenId)
      .run();
    expect(
      (await retrieveMemories(local.db, env, fixture.scope, "好み", now)).map((item) => item.id),
    ).toEqual([fixture.memoryId, greenId]);
  });

  it("ranking中の例外は空の結果として扱う", async () => {
    const fixture = await seed();
    const env = bindings();
    await indexMemoryJob(local.db, env, fixture.jobId);
    await expect(
      retrieveMemories(local.db, env, fixture.scope, "好み", Number.NaN),
    ).resolves.toEqual([]);
  });

  it("indexの失敗はQueueで再試行し、抽出を再実行せずに完了する", async () => {
    const fixture = await seed();
    const env = bindings();
    env.upsertMock.mockRejectedValueOnce(new Error("offline"));
    const ack = vi.fn();
    const retry = vi.fn();
    const batch: MessageBatch<unknown> = {
      queue: "local-memory",
      ackAll: vi.fn(),
      retryAll: vi.fn(),
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      messages: [
        {
          id: "delivery",
          timestamp: new Date(),
          body: { jobId: fixture.jobId },
          attempts: 1,
          ack,
          retry,
        },
      ],
    };
    const workerEnv = {
      ...env,
      DB: local.d1,
      APP_ENV: "test",
      V2_FAKE_MODEL: "0",
      V2_MODEL: "unused",
      OPENROUTER_API_KEY: "",
    };
    await consumeMemoryJobs(batch, workerEnv);
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(ack).not.toHaveBeenCalled();
    await consumeMemoryJobs(batch, workerEnv);
    expect(ack).toHaveBeenCalledOnce();
    expect(await listPendingMemoryJobs(local.db, fixture.scope, true)).toEqual([]);

    const terminal = await seed();
    env.upsertMock.mockRejectedValueOnce(new Error("offline"));
    await consumeMemoryJobs(
      {
        ...batch,
        messages: [{ ...batch.messages[0], body: { jobId: terminal.jobId }, attempts: 5 }],
      },
      workerEnv,
    );
    const job = await local.d1
      .prepare("SELECT state, error_code AS errorCode FROM v2_memory_job WHERE id = ?")
      .bind(terminal.jobId)
      .first<{ state: string; errorCode: string | null }>();
    expect(job).toMatchObject({ state: "failed", errorCode: "index_failed" });
    expect(await listPendingMemoryJobs(local.db, terminal.scope, true)).toEqual([]);
  });

  it("1024次元以外をindexへ送らず、書込み中の編集も完了扱いにしない", async () => {
    const fixture = await seed();
    const env = bindings();
    env.runMock.mockResolvedValueOnce({ data: [vector.slice(1)] });
    await expect(indexMemoryJob(local.db, env, fixture.jobId)).rejects.toThrow();
    expect(env.upsertMock).not.toHaveBeenCalled();
    env.upsertMock.mockImplementationOnce(async (vectors: VectorizeVector[]) => {
      for (const item of vectors) env.stored.set(item.id, item);
      await local.d1
        .prepare("UPDATE v2_memory SET content = ?, embedding = NULL WHERE id = ?")
        .bind("珈琲が好き", fixture.memoryId)
        .run();
      return { ids: vectors.map((item) => item.id), count: vectors.length };
    });
    await indexMemoryJob(local.db, env, fixture.jobId);
    const memory = await local.d1
      .prepare("SELECT embedding FROM v2_memory WHERE id = ?")
      .bind(fixture.memoryId)
      .first<{ embedding: unknown | null }>();
    expect(memory).toMatchObject({ embedding: null });
    expect(await retrieveMemories(local.db, env, fixture.scope, "好きな飲み物", now)).toEqual([]);
  });
});
