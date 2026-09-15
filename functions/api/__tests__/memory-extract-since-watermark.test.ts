// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできないため、このファイルだけ node 環境で走らせる。
import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

import type { DatabaseSync } from "node:sqlite";

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch {
  // この Node ビルドでは node:sqlite が無効化されている。
}

// since を送っても、どこまで読んだかがクライアントへ返らんかったら次のターンで送る値が無い。
// 結果として毎ターン直近50件を読み直し、同じ往復を抽出モデルへ食わせ続ける。
// 「実際に読んだ最新メッセージの時刻」が返ることを、実 SQLite で観測する。
const AUTH_TOKEN = "test-token";
const USER_ID = "sukererion@gmail.com";
const CHARACTER_ID = "char-mio";
const CONVERSATION_ID = "conv-1";
const JSON_HEADERS = { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" };

const MESSAGE_TIMES = [1_000, 2_000, 3_000, 4_000] as const;
const NEWEST_MESSAGE_AT = MESSAGE_TIMES[MESSAGE_TIMES.length - 1];

type TestHarness = { db: DatabaseSync; DB: unknown };
type ExtractBody = { inserted: number; facts: unknown[]; nextSince?: number };

const makeRealD1 = (): TestHarness => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is not available");
  const db = new DatabaseSyncCtor(":memory:");
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE character (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT,
      gender TEXT,
      is_official INTEGER NOT NULL DEFAULT 0, system_prompt TEXT NOT NULL DEFAULT '',
      visual_prompt TEXT, seed INTEGER, image_meta TEXT,
      lora_model TEXT, lora_weight REAL, lora_trigger_prompt TEXT,
      greeting TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', sub_avatars TEXT,
      user_persona_name TEXT, user_persona_gender TEXT, user_persona_personality TEXT,
      display_order INTEGER NOT NULL DEFAULT 0, slug TEXT, created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversation (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      title TEXT NOT NULL, parent_conversation_id TEXT, branched_from_message_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      rolling_summary TEXT, summary_updated_at INTEGER, sexual_state TEXT, scene_state TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      character_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      image_url TEXT, image_key TEXT, image_prompt TEXT, image_seed TEXT,
      image_lora_model TEXT, image_lora_weight REAL, image_lora_trigger_prompt TEXT,
      retry_count INTEGER, refusal_detected INTEGER,
      generation_model TEXT, raw_output TEXT, generation_phase TEXT, quality_meta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE memory_note (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      content TEXT NOT NULL, source_message_id TEXT, created_at INTEGER NOT NULL,
      edited_at INTEGER, last_used_at INTEGER, usage_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE request_counter (
      user_id TEXT NOT NULL, period TEXT NOT NULL, counter_type TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, period, counter_type)
    );
    CREATE TABLE usage_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, model TEXT,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      conversation_id TEXT
    );
  `);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(USER_ID, USER_ID);
  db.prepare(
    "INSERT INTO character (id, user_id, name, system_prompt, greeting) VALUES (?, ?, ?, '', '')",
  ).run(CHARACTER_ID, USER_ID, "みお");
  db.prepare(
    "INSERT INTO conversation (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(CONVERSATION_ID, USER_ID, CHARACTER_ID, "会話", 0, 0);
  MESSAGE_TIMES.forEach((createdAt, index) => {
    db.prepare(
      "INSERT INTO message (id, user_id, conversation_id, character_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      `msg-${index}`,
      USER_ID,
      CONVERSATION_ID,
      CHARACTER_ID,
      index % 2 === 0 ? "user" : "assistant",
      `メッセージ${index}`,
      createdAt,
    );
  });

  const wrap = (sql: string, args: unknown[]) => {
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const returnsRows = /^\s*select/i.test(sql) || /\breturning\b/i.test(sql);
    let cached: Record<string, unknown>[] | undefined;
    let changes = 0;
    const rows = (): Record<string, unknown>[] => {
      if (cached === undefined) {
        if (returnsRows) {
          cached = db.prepare(sql).all(...bound) as Record<string, unknown>[];
        } else {
          changes = Number(db.prepare(sql).run(...bound).changes);
          cached = [];
        }
      }
      return cached;
    };
    return {
      all: async () => ({ results: rows(), success: true }),
      first: async () => rows()[0] ?? null,
      run: async () => {
        rows();
        return { success: true, meta: { changes }, results: [] };
      },
      raw: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
      values: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
      // enforceRateLimit は batch() の meta.changes で予約成否を判定する。
      __exec: () => {
        rows();
        return { success: true, meta: { changes }, results: [] };
      },
    };
  };

  const DB = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => wrap(sql, args), ...wrap(sql, []) }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: async (statements: { __exec: () => unknown }[]) => statements.map((s) => s.__exec()),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return { db, DB };
};

const makeExecutionCtx = (): ExecutionContext => ({
  waitUntil: (promise: Promise<unknown>): void => {
    void Promise.resolve(promise).catch(() => undefined);
  },
  passThroughOnException: (): void => undefined,
  props: {},
});

// 抽出モデルへ渡ったプロンプト本文を覗く。どの往復が読まれたかは、これでしか観測でけへん。
const stubExtractionModel = (): string[] => {
  const prompts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      prompts.push(String(init?.body ?? ""));
      void input;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[]}' } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return prompts;
};

const postExtract = (harness: TestHarness, body: Record<string, unknown>) =>
  app.request(
    "/api/memory/extract",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
    { AUTH_TOKEN, DB: harness.DB, OPENROUTER_API_KEY: "", NOVITA_API_KEY: "" },
    makeExecutionCtx(),
  );

describe.skipIf(!DatabaseSyncCtor)("POST /api/memory/extract の抽出済み境界", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("読んだ最新メッセージの時刻を nextSince として返す", async () => {
    const harness = makeRealD1();
    stubExtractionModel();

    const response = await postExtract(harness, {
      conversationId: CONVERSATION_ID,
      characterId: CHARACTER_ID,
    });

    expect(response.status).toBe(200);
    const body: ExtractBody = await response.json();
    expect(body.nextSince).toBe(NEWEST_MESSAGE_AT);
  });

  it("since 以降だけを抽出モデルへ渡し、その最新時刻を nextSince として返す", async () => {
    const harness = makeRealD1();
    const prompts = stubExtractionModel();

    const response = await postExtract(harness, {
      conversationId: CONVERSATION_ID,
      characterId: CHARACTER_ID,
      since: MESSAGE_TIMES[1],
    });

    expect(response.status).toBe(200);
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("メッセージ2");
    expect(prompt).toContain("メッセージ3");
    expect(prompt).not.toContain("メッセージ0");
    expect(prompt).not.toContain("メッセージ1");
    const body: ExtractBody = await response.json();
    expect(body.nextSince).toBe(NEWEST_MESSAGE_AT);
  });

  // 往復が足りず抽出せんかった回は境界を返さん。返してまうと、読んだだけで抽出してへん
  // 往復をクライアントが飛ばして、二度と抽出されんようになる。
  it("抽出が走らんかった回は nextSince を返さん", async () => {
    const harness = makeRealD1();
    stubExtractionModel();

    const response = await postExtract(harness, {
      conversationId: CONVERSATION_ID,
      characterId: CHARACTER_ID,
      since: MESSAGE_TIMES[2],
    });

    expect(response.status).toBe(200);
    const body: ExtractBody = await response.json();
    expect(body.nextSince).toBeUndefined();
  });
});
