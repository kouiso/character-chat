// @vitest-environment node
// RIT-74 FR-6/FR-8: POST /api/admin/memory-reindex — mode:"failed" は index_failed の job を
// 戻し、mode:"all" は記憶の embedding を null にして次の送りで入れ直させる。
// 種まきと掃除は @v2/db の createDb か生 SQL（api-admin-migration.test.ts と同じ理由）。
import {
  characterTable,
  completeMemoryExtraction,
  ensureLocalUser,
  hashMemorySource,
  listPendingMemoryJobs,
  loadMemoryExtractionSource,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MessageTable,
  type ExtractedMemory,
} from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  FRESH_LOCAL_D1_TIMEOUT_MS,
  openLocalD1,
  type LocalD1,
} from "../../../../packages/db/src/test/local-d1";

import { consumeMemoryJobs } from "./memory-queue";
import { memoryVectorId } from "./memory-vector";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: platform.env }) }));

const { handleMemoryReindex } = await import("./api-admin-memory");

const post = (body: unknown, contentType = "application/json") =>
  handleMemoryReindex(
    new Request("https://v2.test/api/admin/memory-reindex", {
      method: "POST",
      headers: { "content-type": contentType },
      body: JSON.stringify(body),
    }),
  );

const now = Date.now();
const characterId = crypto.randomUUID();
const preference: ExtractedMemory = {
  kind: "preference",
  content: "紅茶が好き",
  subject: "",
  category: "long",
  importance: 3,
  validFrom: null,
  validUntil: null,
};
const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));

// 会話・元発言・job・抜き出し済みの記憶 1 件を植える（memory-rag.test.ts の seed と同じ形）。
const seed = async (
  local: LocalD1,
  userId: string,
): Promise<{ conversationId: string; jobId: string; memoryId: string }> => {
  const conversationId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
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
      turn: 1,
      role: "user",
      content: preference.content,
      createdAt: now,
    }),
    local.db.insert(v2MemoryJobTable).values({
      id: jobId,
      sourceMessageId: jobId,
      sourceTurn: 1,
      conversationId,
      userId,
      characterId,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  const source = await loadMemoryExtractionSource(local.db, jobId);
  if (!source) throw new Error("missing fixture source");
  await completeMemoryExtraction(local.db, source, [preference]);
  return { conversationId, jobId, memoryId: `${jobId}:0` };
};

const cleanup = async (local: LocalD1, conversationId: string) => {
  for (const [sql, id] of [
    ["DELETE FROM v2_memory WHERE conversation_id = ?", conversationId],
    ["DELETE FROM v2_memory_job WHERE conversation_id = ?", conversationId],
    ["DELETE FROM v2_message WHERE conversation_id = ?", conversationId],
    ["DELETE FROM v2_conversation WHERE id = ?", conversationId],
  ] as const) {
    await local.d1.prepare(sql).bind(id).run();
  }
};

describe("POST /api/admin/memory-reindex", () => {
  let local: LocalD1;

  beforeAll(async () => {
    local = await openLocalD1();
    platform.env = { DB: local.d1 };
    await ensureLocalUser(local.db);
    await local.db.insert(characterTable).values({
      id: characterId,
      userId: "local",
      name: "案内役",
      systemPrompt: "テスト用の案内役です。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: now,
    });
  }, FRESH_LOCAL_D1_TIMEOUT_MS);

  afterAll(async () => {
    await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(characterId).run();
    platform.env = {};
    await local.dispose();
  });

  it("形が違えば 400 invalid_request、POST 以外は 405、JSON でなければ 415", async () => {
    const get = await handleMemoryReindex(
      new Request("https://v2.test/api/admin/memory-reindex", { method: "GET" }),
    );
    expect(get.status).toBe(405);
    const notJson = await post({ mode: "failed" }, "text/plain");
    expect(notJson.status).toBe(415);
    // mode の列挙外・conversationId の長さ超過・知らん項目・all の会話指定無しは全部 400
    for (const body of [
      { mode: "x" },
      { conversationId: "c".repeat(121) },
      { mode: "failed", extra: 1 },
      { mode: "all" },
      "not-an-object",
    ]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "invalid_request" });
    }
  });

  it("mode の既定は failed。index_failed の job だけを未完成へ戻し、次の送りで拾われる", async () => {
    const own = await seed(local, "local");
    const other = await seed(local, "other-owner");
    try {
      // own は index_failed（5 回失敗の末）、other は別利用者で同じ姿。
      for (const jobId of [own.jobId, other.jobId]) {
        await local.d1
          .prepare(
            "UPDATE v2_memory_job SET error_code = 'index_failed', index_attempts = 5 WHERE id = ?",
          )
          .bind(jobId)
          .run();
      }
      // conversationId 省略 → その利用者の全会話。mode 省略 → failed。
      const response = await post({});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ reset: 1 });

      const job = await local.d1
        .prepare(
          "SELECT state, error_code AS errorCode, index_attempts AS n FROM v2_memory_job WHERE id = ?",
        )
        .bind(own.jobId)
        .first<{ state: string; errorCode: string | null; n: number }>();
      expect(job).toMatchObject({ state: "completed", errorCode: null, n: 0 });
      // 戻した job は未索引の記憶を持つので次の送りで拾われる
      const scope = {
        userId: "local",
        characterId,
        conversationId: own.conversationId,
      };
      expect((await listPendingMemoryJobs(local.db, scope, true)).map((row) => row.id)).toContain(
        own.jobId,
      );

      // 別の利用者の会話は戻らない
      const otherJob = await local.d1
        .prepare(
          "SELECT state, error_code AS errorCode, index_attempts AS n FROM v2_memory_job WHERE id = ?",
        )
        .bind(other.jobId)
        .first<{ state: string; errorCode: string | null; n: number }>();
      expect(otherJob).toMatchObject({ state: "completed", errorCode: "index_failed", n: 5 });
    } finally {
      await cleanup(local, own.conversationId);
      await cleanup(local, other.conversationId);
    }
  });

  it("mode:all は記憶の embedding を null に戻し、次の送りで同じ vector id で upsert される", async () => {
    const own = await seed(local, "local");
    const other = await seed(local, "other-owner");
    try {
      // 索引済みの体にする（4096 バイトの埋め込みを直接植える）
      const embedding = new Uint8Array(new Float32Array(vector).buffer);
      for (const { memoryId } of [own, other]) {
        await local.d1
          .prepare("UPDATE v2_memory SET embedding = ? WHERE id = ?")
          .bind(embedding, memoryId)
          .run();
      }
      const response = await post({ mode: "all", conversationId: own.conversationId });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ reset: 1 });

      const memory = await local.d1
        .prepare("SELECT embedding FROM v2_memory WHERE id = ?")
        .bind(own.memoryId)
        .first<{ embedding: unknown | null }>();
      expect(memory).toMatchObject({ embedding: null });
      const job = await local.d1
        .prepare(
          "SELECT state, error_code AS errorCode, index_attempts AS n FROM v2_memory_job WHERE id = ?",
        )
        .bind(own.jobId)
        .first<{ state: string; errorCode: string | null; n: number }>();
      expect(job).toMatchObject({ state: "completed", errorCode: null, n: 0 });

      // 別の利用者の記憶の embedding は残る
      const otherMemory = await local.d1
        .prepare("SELECT length(embedding) AS bytes FROM v2_memory WHERE id = ?")
        .bind(other.memoryId)
        .first<{ bytes: number | null }>();
      expect(otherMemory?.bytes).toBe(4096);

      // 次の送り: 未索引に戻った job が拾われ、同じ vector id で upsert が呼ばれる（件数は増えん）。
      const scope = { userId: "local", characterId, conversationId: own.conversationId };
      const pending = await listPendingMemoryJobs(local.db, scope, true);
      expect(pending.map((row) => row.id)).toContain(own.jobId);
      const upsertMock = vi.fn().mockResolvedValue({ ids: [], count: 0 });
      const runMock = vi.fn().mockResolvedValue({ data: [vector] });
      await consumeMemoryJobs(
        {
          queue: "local-memory",
          ackAll: vi.fn(),
          retryAll: vi.fn(),
          metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
          messages: [
            {
              id: "reindex-delivery",
              timestamp: new Date(),
              body: { jobId: own.jobId },
              attempts: 1,
              ack: vi.fn(),
              retry: vi.fn(),
            },
          ],
        },
        {
          DB: local.d1,
          APP_ENV: "test",
          V2_FAKE_MODEL: "1",
          V2_MODEL: "unused",
          OPENROUTER_API_KEY: "",
          V2_RAG_ENABLED: "1",
          AI: { run: runMock as unknown as Ai["run"] },
          MEMORY_INDEX: {
            upsert: upsertMock as unknown as VectorizeIndex["upsert"],
            query: vi.fn() as unknown as VectorizeIndex["query"],
          },
        },
      );
      const hash = await hashMemorySource(preference.content);
      const expectedId = await memoryVectorId(own.memoryId, hash);
      expect(upsertMock).toHaveBeenCalledWith([expect.objectContaining({ id: expectedId })]);
    } finally {
      await cleanup(local, own.conversationId);
      await cleanup(local, other.conversationId);
    }
  });
});
