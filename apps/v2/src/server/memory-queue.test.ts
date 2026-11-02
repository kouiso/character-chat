// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  characterTable,
  loadMemoryExtractionSource,
  userTable,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MessageTable,
} from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { consumeMemoryJobs, publishMemoryJobs } from "./memory-queue";

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
});
