// @vitest-environment node
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterContentSchema,
  characterTable,
  createCharacterWithVersion,
  listRedactPendingSummaries,
  loadMemoryExtractionSource,
  userTable,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MemoryTombstoneTable,
  v2MessageTable,
  v2SummaryTable,
  hashMemorySource,
} from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import {
  consumeMemoryJobs,
  publishMemoryJobs,
  resolveMemoryExtractionModels,
  runMemoryExtraction,
  runSummaryRedact,
} from "./memory-queue";

const userId = `memory-queue-test-${crypto.randomUUID()}`;
const characterId = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const now = Date.now();
const scope = { userId, characterId, conversationId };
const triggerName = "memory_queue_test_fail_queued";

describe("memory queue publisher", () => {
  let local: LocalD1;
  let persistRoot: string | undefined;

  beforeAll(async () => {
    persistRoot = await mkdtemp(join(tmpdir(), "v2-memory-queue-"));
    local = await openLocalD1({ persistRoot });
    await local.db.insert(userTable).values({
      id: userId,
      email: `${userId}@example.invalid`,
      createdAt: now,
    });
    await local.db.insert(characterTable).values({
      id: characterId,
      userId,
      name: "案内役",
      systemPrompt: "テスト用の案内役です。",
      greeting: "こんにちは。",
      tags: [],
      createdAt: now,
    });
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
        content: "私は紅茶が好きです。",
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
  }, 120_000);

  afterAll(async () => {
    if (local) {
      await local.d1.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
      await local.d1
        .prepare("DELETE FROM v2_memory WHERE conversation_id = ?")
        .bind(conversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_summary WHERE conversation_id = ?")
        .bind(conversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_memory_tombstone WHERE conversation_id = ?")
        .bind(conversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_memory_job WHERE conversation_id = ?")
        .bind(conversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_message WHERE conversation_id = ?")
        .bind(conversationId)
        .run();
      await local.d1.prepare("DELETE FROM v2_conversation WHERE id = ?").bind(conversationId).run();
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(characterId).run();
      await local.d1.prepare("DELETE FROM user WHERE id = ?").bind(userId).run();
      await local.dispose();
    }
    if (persistRoot) await rm(persistRoot, { recursive: true, force: true });
  });

  it("keeps a delivery eligible when its accepted send cannot be marked queued", async () => {
    const delivered: { body: unknown }[] = [];
    let sends = 0;
    const queue = {
      sendBatch: vi.fn(async (messages: Iterable<{ body: unknown }>) => {
        sends += 1;
        const batch = [...messages];
        if (sends <= 4) throw new Error("queue offline");
        delivered.push(...batch);
      }),
    } as unknown as Parameters<typeof publishMemoryJobs>[1];
    const beforeSend = vi.fn(async () => undefined);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(publishMemoryJobs(local.db, queue, scope, beforeSend)).resolves.toBe(true);
    }

    await local.d1.exec(
      `CREATE TRIGGER ${triggerName} BEFORE UPDATE OF state ON v2_memory_job WHEN NEW.state = 'queued' BEGIN SELECT RAISE(ABORT, 'test queued-state failure'); END`,
    );
    let publishError: unknown;
    try {
      await publishMemoryJobs(local.db, queue, scope, beforeSend);
    } catch (error) {
      publishError = error;
    }
    await local.d1.exec(`DROP TRIGGER ${triggerName}`);

    const job = await local.d1
      .prepare("SELECT state, publish_attempts AS publishAttempts FROM v2_memory_job WHERE id = ?")
      .bind(jobId)
      .first<{ state: string; publishAttempts: number }>();
    expect(job).toMatchObject({ state: "pending", publishAttempts: 4 });
    expect(publishError).toBeDefined();
    expect(await loadMemoryExtractionSource(local.db, jobId)).not.toBeNull();

    const delivery = delivered[0];
    if (!delivery) throw new Error("accepted queue delivery missing");
    const ack = vi.fn();
    const retry = vi.fn();
    const batch: MessageBatch<unknown> = {
      queue: "local-memory",
      ackAll: vi.fn(),
      retryAll: vi.fn(),
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      messages: [
        {
          id: "accepted-delivery",
          timestamp: new Date(),
          body: delivery.body,
          attempts: 1,
          ack,
          retry,
        },
      ],
    };
    await consumeMemoryJobs(batch, {
      DB: local.d1,
      APP_ENV: "test",
      V2_FAKE_MODEL: "1",
      V2_MODEL: "unused",
      OPENROUTER_API_KEY: "",
      V2_RAG_ENABLED: "0",
    });
    expect(ack).toHaveBeenCalledOnce();
    const completed = await local.d1
      .prepare("SELECT state FROM v2_memory_job WHERE id = ?")
      .bind(jobId)
      .first<{ state: string }>();
    expect(completed?.state).toBe("completed");
  });

  it("キャラの方針が許さん種類の記憶は保存せず、方針は会話が固定した版から読む", async () => {
    const content = characterContentSchema.parse({
      name: "方針役",
      personality: "案内役",
      speechStyle: "丁寧",
      greeting: "こんにちは。",
      memoryInstruction: "好みだけを記憶せよ",
      memoryKinds: ["preference"],
    });
    const created = await createCharacterWithVersion(local.db, userId, content);
    const policyConversationId = crypto.randomUUID();
    const policyJobId = crypto.randomUUID();
    try {
      await local.db.batch([
        local.db.insert(v2ConversationTable).values({
          id: policyConversationId,
          userId,
          characterId: created.id,
          threadId: policyConversationId,
          promptVersion: "test",
          characterVersionId: created.versionId,
          createdAt: now,
          updatedAt: now,
        }),
        local.db.insert(v2MessageTable).values({
          id: policyJobId,
          conversationId: policyConversationId,
          turn: 1,
          role: "user",
          content: "私は紅茶が好きです。",
          createdAt: now,
        }),
        local.db.insert(v2MemoryJobTable).values({
          id: policyJobId,
          sourceMessageId: policyJobId,
          sourceTurn: 1,
          conversationId: policyConversationId,
          userId,
          characterId: created.id,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      const ack = vi.fn();
      const batch: MessageBatch<unknown> = {
        queue: "local-memory",
        ackAll: vi.fn(),
        retryAll: vi.fn(),
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "policy-delivery",
            timestamp: new Date(),
            body: { jobId: policyJobId },
            attempts: 1,
            ack,
            retry: vi.fn(),
          },
        ],
      };
      // 偽モデルは fact を返すが、方針は preference のみ許すので記憶は増えん。
      await consumeMemoryJobs(batch, {
        DB: local.d1,
        APP_ENV: "test",
        V2_FAKE_MODEL: "1",
        V2_MODEL: "unused",
        OPENROUTER_API_KEY: "",
        V2_RAG_ENABLED: "0",
      });
      expect(ack).toHaveBeenCalledOnce();
      const memories = await local.d1
        .prepare("SELECT id FROM v2_memory WHERE conversation_id = ?")
        .bind(policyConversationId)
        .all();
      expect(memories.results).toEqual([]);
      const job = await local.d1
        .prepare("SELECT state FROM v2_memory_job WHERE id = ?")
        .bind(policyJobId)
        .first<{ state: string }>();
      expect(job?.state).toBe("completed");
    } finally {
      await local.d1
        .prepare("DELETE FROM v2_memory_job WHERE conversation_id = ?")
        .bind(policyConversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_message WHERE conversation_id = ?")
        .bind(policyConversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_conversation WHERE id = ?")
        .bind(policyConversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM character_revision WHERE character_id = ?")
        .bind(created.id)
        .run();
      await local.d1
        .prepare("DELETE FROM character_version WHERE character_id = ?")
        .bind(created.id)
        .run();
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(created.id).run();
    }
  });

  it("覚える種類が空の版ではモデルを 1 回も呼ばず、記憶 0 件で仕事を完了にする", async () => {
    const content = characterContentSchema.parse({
      name: "無記憶役",
      personality: "案内役",
      speechStyle: "丁寧",
      greeting: "こんにちは。",
      memoryInstruction: "何でも覚えてよい",
      memoryKinds: [],
    });
    const created = await createCharacterWithVersion(local.db, userId, content);
    const emptyConversationId = crypto.randomUUID();
    const emptyJobId = crypto.randomUUID();
    const invoke = vi.spyOn(FakeListChatModel.prototype, "invoke");
    try {
      await local.db.batch([
        local.db.insert(v2ConversationTable).values({
          id: emptyConversationId,
          userId,
          characterId: created.id,
          threadId: emptyConversationId,
          promptVersion: "test",
          characterVersionId: created.versionId,
          createdAt: now,
          updatedAt: now,
        }),
        local.db.insert(v2MessageTable).values({
          id: emptyJobId,
          conversationId: emptyConversationId,
          turn: 1,
          role: "user",
          content: "私は紅茶が好きです。",
          createdAt: now,
        }),
        local.db.insert(v2MemoryJobTable).values({
          id: emptyJobId,
          sourceMessageId: emptyJobId,
          sourceTurn: 1,
          conversationId: emptyConversationId,
          userId,
          characterId: created.id,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      const ack = vi.fn();
      const batch: MessageBatch<unknown> = {
        queue: "local-memory",
        ackAll: vi.fn(),
        retryAll: vi.fn(),
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "empty-kinds-delivery",
            timestamp: new Date(),
            body: { jobId: emptyJobId },
            attempts: 1,
            ack,
            retry: vi.fn(),
          },
        ],
      };
      await consumeMemoryJobs(batch, {
        DB: local.d1,
        APP_ENV: "test",
        V2_FAKE_MODEL: "1",
        V2_MODEL: "unused",
        OPENROUTER_API_KEY: "",
        V2_RAG_ENABLED: "0",
      });
      expect(ack).toHaveBeenCalledOnce();
      // 種類が空なら抜き出しのモデルは 0 回（お金を使わん契約）
      expect(invoke).not.toHaveBeenCalled();
      const memories = await local.d1
        .prepare("SELECT id FROM v2_memory WHERE conversation_id = ?")
        .bind(emptyConversationId)
        .all();
      expect(memories.results).toEqual([]);
      const job = await local.d1
        .prepare("SELECT state FROM v2_memory_job WHERE id = ?")
        .bind(emptyJobId)
        .first<{ state: string }>();
      expect(job?.state).toBe("completed");
    } finally {
      invoke.mockRestore();
      await local.d1
        .prepare("DELETE FROM v2_memory WHERE conversation_id = ?")
        .bind(emptyConversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_memory_job WHERE conversation_id = ?")
        .bind(emptyConversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_message WHERE conversation_id = ?")
        .bind(emptyConversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM v2_conversation WHERE id = ?")
        .bind(emptyConversationId)
        .run();
      await local.d1
        .prepare("DELETE FROM character_revision WHERE character_id = ?")
        .bind(created.id)
        .run();
      await local.d1
        .prepare("DELETE FROM character_version WHERE character_id = ?")
        .bind(created.id)
        .run();
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(created.id).run();
    }
  });

  it("summary_redact の配送は待ちの要約を墓標の本文で伏せ直して ack する（RIT-94）", async () => {
    // 消した記憶が残った体の要約を植える
    const summaryId = `sum-${crypto.randomUUID()}`;
    await local.db.insert(v2SummaryTable).values({
      id: summaryId,
      conversationId,
      level: 1,
      coveredTo: 1,
      text: "相手は紅茶が好き。他の出来事。",
      redactPending: 1,
      createdAt: Date.now(),
    });
    await local.db.insert(v2MemoryTombstoneTable).values({
      conversationId,
      contentHash: await hashMemorySource("紅茶が好き"),
      content: "紅茶が好き",
      createdAt: Date.now(),
    });

    const ack = vi.fn();
    const batch: MessageBatch<unknown> = {
      queue: "local-memory",
      ackAll: vi.fn(),
      retryAll: vi.fn(),
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      messages: [
        {
          id: "redact-delivery",
          timestamp: new Date(),
          // 体は type と conversationId だけ — 本文は D1 の墓標から読む（NFR-2）
          body: { type: "summary_redact", conversationId },
          attempts: 1,
          ack,
          retry: vi.fn(),
        },
      ],
    };
    await consumeMemoryJobs(batch, {
      DB: local.d1,
      APP_ENV: "test",
      V2_FAKE_MODEL: "1",
      V2_MODEL: "unused",
      OPENROUTER_API_KEY: "",
      V2_RAG_ENABLED: "0",
    });
    expect(ack).toHaveBeenCalledOnce();
    const summary = await local.d1
      .prepare("SELECT text, redact_pending AS pending FROM v2_summary WHERE id = ?")
      .bind(summaryId)
      .first<{ text: string; pending: number }>();
    expect(summary?.pending).toBe(0);
    expect(summary?.text).not.toContain("紅茶が好き");
    expect(await listRedactPendingSummaries(local.db, conversationId)).toEqual([]);
  });

  it("伏せ直しが失敗したら retry、4 回目の失敗で要約の行を消して ack（FR-4）", async () => {
    const keepId = `keep-${crypto.randomUUID()}`;
    const doomedId = `doomed-${crypto.randomUUID()}`;
    await local.db.insert(v2SummaryTable).values({
      id: keepId,
      conversationId,
      level: 1,
      coveredTo: 2,
      text: "残る要約",
      redactPending: 1,
      createdAt: Date.now(),
    });
    await local.db.insert(v2SummaryTable).values({
      id: doomedId,
      conversationId,
      level: 1,
      coveredTo: 3,
      text: "消える要約",
      redactPending: 1,
      createdAt: Date.now(),
    });

    // 失敗するモデル → retry（要約は待ちのまま）
    const retry = vi.fn();
    const ackEarly = vi.fn();
    const throwing = new FakeListChatModel({ responses: [] });
    await runSummaryRedact(
      local.db,
      {},
      throwing,
      { attempts: 2, ack: ackEarly, retry },
      conversationId,
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(ackEarly).not.toHaveBeenCalled();
    expect(await listRedactPendingSummaries(local.db, conversationId)).toHaveLength(2);

    // 4 回目の失敗: 待ちの行を 1 行ずつ消して ack（要約は次の summarize で作り直される）
    const ackLate = vi.fn();
    const retryLate = vi.fn();
    await runSummaryRedact(
      local.db,
      {},
      new FakeListChatModel({ responses: [] }),
      { attempts: 4, ack: ackLate, retry: retryLate },
      conversationId,
    );
    expect(ackLate).toHaveBeenCalledOnce();
    expect(retryLate).not.toHaveBeenCalled();
    const remaining = await local.d1
      .prepare("SELECT id FROM v2_summary WHERE id IN (?, ?)")
      .bind(keepId, doomedId)
      .all();
    expect(remaining.results).toEqual([]);
    expect(await listRedactPendingSummaries(local.db, conversationId)).toEqual([]);
  });

  // 1 件の予約を会話・発言・job の 3 行で仕込む。
  const seedJob = async (text: string) => {
    const seedConversationId = crypto.randomUUID();
    const seedJobId = crypto.randomUUID();
    await local.db.batch([
      local.db.insert(v2ConversationTable).values({
        id: seedConversationId,
        userId,
        characterId,
        threadId: seedConversationId,
        promptVersion: "test",
        createdAt: now,
        updatedAt: now,
      }),
      local.db.insert(v2MessageTable).values({
        id: seedJobId,
        conversationId: seedConversationId,
        turn: 1,
        role: "user",
        content: text,
        createdAt: now,
      }),
      local.db.insert(v2MemoryJobTable).values({
        id: seedJobId,
        sourceMessageId: seedJobId,
        sourceTurn: 1,
        conversationId: seedConversationId,
        userId,
        characterId,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const source = await loadMemoryExtractionSource(local.db, seedJobId);
    if (!source) throw new Error("source missing");
    return { source, seedJobId, seedConversationId };
  };

  const cleanupSeed = async (seedConversationId: string) => {
    await local.d1
      .prepare("DELETE FROM v2_memory WHERE conversation_id = ?")
      .bind(seedConversationId)
      .run();
    await local.d1
      .prepare("DELETE FROM v2_memory_job WHERE conversation_id = ?")
      .bind(seedConversationId)
      .run();
    await local.d1
      .prepare("DELETE FROM v2_message WHERE conversation_id = ?")
      .bind(seedConversationId)
      .run();
    await local.d1
      .prepare("DELETE FROM v2_conversation WHERE id = ?")
      .bind(seedConversationId)
      .run();
  };

  it("1 本目のモデルが投げると 2 本目で保存する（FR-8）", async () => {
    const { source, seedJobId, seedConversationId } = await seedJob("私は紅茶が好きです。");
    try {
      const throwing = new FakeListChatModel({ responses: [] });
      const good = new FakeListChatModel({
        responses: [
          JSON.stringify({
            memories: [
              {
                kind: "preference",
                content: "紅茶が好き",
                subject: "好きな飲み物",
                category: "long",
                importance: 3,
                validFrom: null,
                validUntil: null,
              },
            ],
          }),
        ],
      });
      await runMemoryExtraction(local.db, { DB: local.d1 }, source, [throwing, good]);
      const memories = await local.d1
        .prepare("SELECT content, subject, category FROM v2_memory WHERE conversation_id = ?")
        .bind(seedConversationId)
        .all<{ content: string; subject: string; category: string }>();
      expect(memories.results).toEqual([
        { content: "紅茶が好き", subject: "好きな飲み物", category: "long" },
      ]);
      const job = await local.d1
        .prepare("SELECT state FROM v2_memory_job WHERE id = ?")
        .bind(seedJobId)
        .first<{ state: string }>();
      expect(job?.state).toBe("completed");
    } finally {
      await cleanupSeed(seedConversationId);
    }
  });

  it("セーフモードが入の利用者は V2_SAFE_MODEL_CHAIN、切は V2_MODEL_CHAIN を使う（FR-8）", async () => {
    const env = {
      DB: local.d1,
      APP_ENV: "staging",
      OPENROUTER_API_KEY: "test-key",
      V2_SAFE_MODEL_CHAIN: '[{"model":"safe-a"},{"model":"safe-b"}]',
      V2_MODEL_CHAIN: '[{"model":"normal-a"}]',
    };
    const source = {
      id: crypto.randomUUID(),
      conversationId,
      userId,
      characterId,
      sourceMessageId: crypto.randomUUID(),
      sourceTurn: 1,
      content: "私は紅茶が好きです。",
      createdAt: now,
    };
    try {
      // 未設定 = 切 → 通常の鎖
      expect((await resolveMemoryExtractionModels(env, source)).map((c) => c.name)).toEqual([
        "normal-a",
      ]);
      await local.d1
        .prepare("INSERT INTO v2_user_settings (user_id, safe_mode, updated_at) VALUES (?, 1, ?)")
        .bind(userId, Date.now())
        .run();
      // 入 = セーフ側の鎖の値をそのまま使う
      expect((await resolveMemoryExtractionModels(env, source)).map((c) => c.name)).toEqual([
        "safe-a",
        "safe-b",
      ]);
    } finally {
      await local.d1.prepare("DELETE FROM v2_user_settings WHERE user_id = ?").bind(userId).run();
    }
  });

  it("memory-extract-fail は staging・test で投げ、production では投げない（6-b）", async () => {
    const first = await seedJob("私は紅茶が好きです。");
    const second = await seedJob("私は紅茶が好きです。");
    const good = new FakeListChatModel({
      responses: [
        JSON.stringify({
          memories: [
            {
              kind: "fact",
              content: "紅茶が好き",
              subject: "",
              category: "long",
              importance: 3,
              validFrom: null,
              validUntil: null,
            },
          ],
        }),
      ],
    });
    try {
      // staging・test ではモデルを呼ぶ前に投げる（注入したモデルがあっても呼ばれん）
      await expect(
        runMemoryExtraction(
          local.db,
          {
            DB: local.d1,
            APP_ENV: "staging",
            V2_TEST_FAULT: "memory-extract-fail",
          },
          first.source,
          [good],
        ),
      ).rejects.toThrow();
      // production では値が残っていても無視して普通に抜き出す
      await runMemoryExtraction(
        local.db,
        {
          DB: local.d1,
          APP_ENV: "production",
          V2_TEST_FAULT: "memory-extract-fail",
        },
        second.source,
        [good],
      );
      const memories = await local.d1
        .prepare("SELECT id FROM v2_memory WHERE conversation_id = ?")
        .bind(second.seedConversationId)
        .all();
      expect(memories.results).toHaveLength(1);
    } finally {
      await cleanupSeed(first.seedConversationId);
      await cleanupSeed(second.seedConversationId);
    }
  });

  it("抜き出しの 5 回目の失敗で予約を failed・extraction_failed にして ack する（FR-9）", async () => {
    const { seedJobId, seedConversationId } = await seedJob("私は紅茶が好きです。");
    try {
      const ack = vi.fn();
      const retry = vi.fn();
      const batch: MessageBatch<unknown> = {
        queue: "local-memory",
        ackAll: vi.fn(),
        retryAll: vi.fn(),
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "fifth-delivery",
            timestamp: new Date(),
            body: { jobId: seedJobId },
            attempts: 5,
            ack,
            retry,
          },
        ],
      };
      await consumeMemoryJobs(batch, {
        DB: local.d1,
        APP_ENV: "test",
        V2_FAKE_MODEL: "1",
        V2_TEST_FAULT: "memory-extract-fail",
        OPENROUTER_API_KEY: "",
        V2_RAG_ENABLED: "0",
      });
      expect(ack).toHaveBeenCalledOnce();
      expect(retry).not.toHaveBeenCalled();
      const job = await local.d1
        .prepare("SELECT state, error_code AS errorCode FROM v2_memory_job WHERE id = ?")
        .bind(seedJobId)
        .first<{ state: string; errorCode: string | null }>();
      expect(job).toMatchObject({
        state: "failed",
        errorCode: "extraction_failed",
      });
    } finally {
      await cleanupSeed(seedConversationId);
    }
  });
});
