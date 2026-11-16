// @vitest-environment node
// RIT-66 FR-10: 目印を利用者の発言と上流が投げる例外の message に仕込み、
// 入口・返事・画像・資料検索・話しかけ通知・記憶抜き出し・キュー発行の各失敗を
// 起こしても、console.* の記録と Slack の受け口へ届く本文のどこにも目印が出ん事を
// 確かめる。受け口の URL そのものも記録に出ない（NFR-4）。
import { DatabaseSync } from "node:sqlite";

import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  characterTable,
  createDb,
  userTable,
  v2ConversationTable,
  v2MemoryJobTable,
  v2MessageTable,
} from "@v2/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import type * as EngineModule from "@v2/engine";
import type * as ImageGenerationModule from "./image-generation";

const CANARY = "CANARY-9c1e-秘密の合言葉";
// 受け口の URL に仕込む目印。fetch の宛先には現れてよいが、記録には出てはいけん。
const WEBHOOK_MARKER = "webhook-secret-marker-4d2a";
const WEBHOOK = `https://hooks.slack.test/T00/B00/${WEBHOOK_MARKER}`;
const NOTIFY_ENV = { SLACK_ERROR_WEBHOOK_URL: WEBHOOK, APP_ENV: "staging" } as const;

const waitUntilJobs = vi.hoisted(() => ({ jobs: [] as Promise<unknown>[] }));
const startFetch = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());
const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const replies = vi.hoisted(() => ({ queue: [] as string[][] }));

vi.mock("cloudflare:workers", () => ({
  waitUntil: (job: Promise<unknown>) => void waitUntilJobs.jobs.push(job),
  env: {},
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: startFetch } }));
vi.mock("./platform", () => ({ getPlatform: async () => ({ env: platform.env }) }));

// 返事は偽モデルへ差し替える。空の応答は generation_failed で失敗する。
vi.mock("@v2/engine", async (importOriginal) => {
  const original = await importOriginal<typeof EngineModule>();
  return {
    ...original,
    createModelChain: (): EngineModule.ModelCandidate[] => {
      const responses = replies.queue.shift() ?? [""];
      return [{ name: "fake", model: new FakeListChatModel({ responses }) }];
    },
  };
});

// 画像生成の失敗は上流（Novita 等）が例外を投げた形にする。例外の message に目印を載せる。
vi.mock("./image-generation", async (importOriginal) => {
  const original = await importOriginal<typeof ImageGenerationModule>();
  return {
    ...original,
    generateConversationImage: () => Promise.reject(new Error(`上流の応答 ${CANARY}`)),
    generateConversationComic: () => Promise.reject(new Error(`上流の応答 ${CANARY}`)),
  };
});

const { default: worker } = await import("../worker");
const { ChatRoom } = await import("./chat-room");
const { handleImageRequest } = await import("./api-images");
const { retrieveDocumentChunks } = await import("./document-rag");
const { consumeMemoryJobs, publishMemoryJobs } = await import("./memory-queue");
const { createProactiveSink } = await import("./proactive-sink");

type SqlValue = string | number | null;

// Durable Object の SQLite storage と同じ呼び口だけを持つ器（chat-room.test.ts と同じ作り）。
const createDurableState = () => {
  const sqlite = new DatabaseSync(":memory:");
  const alarms: number[] = [];
  return {
    alarms,
    storage: {
      sql: {
        exec: <T>(query: string, ...bindings: SqlValue[]) => {
          const rows = sqlite.prepare(query).all(...bindings) as T[];
          return { toArray: () => rows };
        },
      },
      transactionSync: <T>(callback: () => T): T => {
        sqlite.exec("BEGIN");
        try {
          const result = callback();
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      setAlarm: async (at: number) => {
        alarms.push(at);
      },
    },
  };
};

describe("目印を仕込んだ失敗が記録・知らせへ本文を漏らさん事", () => {
  let local: LocalD1;
  const consoleOutput: string[] = [];
  const slackBodies: string[] = [];
  const fetchSpy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    slackBodies.push(String(init?.body ?? ""));
    return new Response("ok", { status: 200 });
  });
  const spies = [
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    }),
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    }),
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    }),
  ];

  const drainNotifications = async () => {
    await Promise.all(waitUntilJobs.jobs.splice(0));
  };

  beforeEach(async () => {
    const { resetFailureNotifierState } = await import("./failure-notifier");
    resetFailureNotifierState();
    waitUntilJobs.jobs.length = 0;
    startFetch.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const spy of spies) spy.mockRestore();
    await local?.dispose();
  });

  it("入口・返事・画像・資料検索・通知・記憶・発行の失敗で目印が出ん", async () => {
    local = await openLocalD1();
    const now = Date.now();
    // character は owner（LOCAL_USER_ID = "local"）か isOfficial じゃないと readCharacter が
    // 弾くので、持ち主はローカル利用者に合わせる（runtime-seed.sql と同じ持ち方）。
    const userId = "local";
    const characterId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await local.db
      .insert(userTable)
      .values({
        id: userId,
        email: `leak-test-${crypto.randomUUID()}@example.invalid`,
        createdAt: now,
      })
      .onConflictDoNothing();
    await local.db.insert(characterTable).values({
      id: characterId,
      userId,
      name: "目印役",
      systemPrompt: "あなたは番人です。",
      greeting: "よう来た。",
      tags: [],
      createdAt: now,
    });

    // ── 1. 入口の例外（worker_request_failed）上流の message に目印 ──
    startFetch.mockRejectedValue(new Error(`上流の障害 ${CANARY}`));
    const credentials = { BASIC_AUTH_USERNAME: "reader", BASIC_AUTH_PASSWORD: "test-only-pass" };
    const authorization = `Basic ${Buffer.from("reader:test-only-pass").toString("base64")}`;
    const entryEnv = {
      ASSETS: { fetch: vi.fn(async () => new Response(null, { status: 404 })) },
      ...credentials,
      ...NOTIFY_ENV,
    };
    const entryResponse = await worker.fetch(
      new Request("https://example.com/", { headers: { authorization } }),
      entryEnv,
    );
    expect(entryResponse.status).toBe(500);

    // ── 2. 返事の失敗（chat_turn_failed）利用者の発言に目印 ──
    platform.env = { DB: local.d1, ...NOTIFY_ENV };
    const state = createDurableState();
    const room = new ChatRoom(
      state as unknown as DurableObjectState,
      platform.env as unknown as Cloudflare.Env,
    );
    const turnConversation = crypto.randomUUID();
    const submit = await room.submit({
      requestId: "leak-req-1",
      conversationId: turnConversation,
      characterId,
      text: `お茶にしよう。${CANARY}`,
    });
    expect(submit.status).toBe("accepted");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await room.alarm();
      if (attempt < 2) {
        const retry = await room.submit({
          requestId: "leak-req-1",
          conversationId: turnConversation,
          characterId,
          text: `お茶にしよう。${CANARY}`,
          retry: true,
        });
        expect(retry.status).toBe("accepted");
      }
    }
    expect(room.readEvents("leak-req-1", 0).status).toBe("failed");

    // ── 3. 画像の失敗（image_generation_error）上流例外に目印 ──
    const imageResponse = await handleImageRequest(
      characterId,
      new Request("https://example.com/api/chat/x/images", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: turnConversation }),
      }),
    );
    expect(imageResponse.status).toBe(500);

    // ── 4. 資料検索の失敗（document_retrieval_failed）埋め込み側が目印つき例外 ──
    const db = createDb(local.d1);
    const docs = await retrieveDocumentChunks(
      db,
      {
        V2_RAG_ENABLED: "1",
        AI: {
          run: async () => {
            throw new Error(`埋め込みの上流 ${CANARY}`);
          },
        },
        MEMORY_INDEX: { query: async () => ({ matches: [] }) } as never,
      },
      { userId, characterId },
      `探したい文 ${CANARY}`,
    );
    expect(docs).toEqual([]);

    // ── 5. 話しかけ通知の失敗（proactive_push_failed）push が目印つき例外 ──
    const sink = createProactiveSink({
      db,
      env: NOTIFY_ENV,
      model: new FakeListChatModel({ responses: ["そろそろお茶にせんか。"] }),
      push: () => Promise.reject(new Error(`push 配信 ${CANARY}`)),
    });
    await sink.send({
      alarmId: "leak-alarm-1",
      characterId,
      idempotencyKey: `leak-${crypto.randomUUID()}`,
    });

    // ── 6. 記憶の抜き出しの失敗（memory_extraction_failed）利用者の発言に目印 ──
    const jobMessageId = crypto.randomUUID();
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
        id: jobMessageId,
        conversationId,
        turn: 1,
        role: "user",
        content: `私は ${CANARY} が好きです。`,
        createdAt: now,
      }),
      local.db.insert(v2MemoryJobTable).values({
        id: jobId,
        sourceMessageId: jobMessageId,
        sourceTurn: 1,
        conversationId,
        userId,
        characterId,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const acks = { acked: 0 };
    await consumeMemoryJobs(
      {
        messages: [
          {
            body: { jobId },
            attempts: 5,
            ack: () => {
              acks.acked += 1;
            },
            retry: () => undefined,
          } as unknown as Message<unknown>,
        ],
      } as unknown as MessageBatch<unknown>,
      {
        DB: local.d1,
        APP_ENV: "test",
        V2_FAKE_MODEL: "0",
        OPENROUTER_API_KEY: "",
        SLACK_ERROR_WEBHOOK_URL: WEBHOOK,
      },
    );
    expect(acks.acked).toBe(1);

    // ── 7. 記憶キュー発行の失敗（memory_queue_publish_failed）上流例外に目印 ──
    const jobId2 = crypto.randomUUID();
    const jobMessageId2 = crypto.randomUUID();
    await local.db.batch([
      local.db.insert(v2MessageTable).values({
        id: jobMessageId2,
        conversationId,
        turn: 2,
        role: "user",
        content: "二つ目の発言です。",
        createdAt: now,
      }),
      local.db.insert(v2MemoryJobTable).values({
        id: jobId2,
        sourceMessageId: jobMessageId2,
        sourceTurn: 2,
        conversationId,
        userId,
        characterId,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    const scope = { userId, characterId, conversationId };
    const queue = {
      sendBatch: vi.fn(async () => {
        throw new Error(`queue 送信 ${CANARY}`);
      }),
    } as unknown as Parameters<typeof publishMemoryJobs>[1];
    await publishMemoryJobs(db, queue, scope, async () => undefined, false, NOTIFY_ENV);

    await drainNotifications();

    // ── 連結した全部に目印が無い ──
    const recorded = consoleOutput.join("\n");
    const notified = slackBodies.join("\n");
    expect(recorded).not.toContain(CANARY);
    expect(notified).not.toContain(CANARY);
    // NFR-4: 受け口の URL の目印も記録へは出ん。
    expect(recorded).not.toContain(WEBHOOK_MARKER);
    // 記録が空振りしていない事: 出来事を持つ JSON 行が実際に出ている。
    expect(recorded).toContain('"event":"worker_request_failed"');
    expect(recorded).toContain('"event":"chat_turn_failed"');
    expect(recorded).toContain('"event":"image_generation_error"');
    expect(recorded).toContain('"event":"document_retrieval_failed"');
    expect(recorded).toContain('"event":"proactive_push_failed"');
    expect(recorded).toContain('"event":"memory_extraction_failed"');
    expect(recorded).toContain('"event":"memory_queue_publish_failed"');
    // 知らせの経路も実際に動いている（宛先の URL だけが webhook を含む）。
    expect(slackBodies.length).toBeGreaterThanOrEqual(4);
    expect(notified).toContain("worker_request_failed");
  }, 120_000);
});
