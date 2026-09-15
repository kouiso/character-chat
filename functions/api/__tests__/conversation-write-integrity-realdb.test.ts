// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできないため、このファイルだけ node 環境で走らせる。
import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";

import type { DatabaseSync } from "node:sqlite";

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch {
  // この Node ビルドでは node:sqlite が無効化されている。
}

// 検証したいのは「行が実際に残るか / 消えるか」なので、書き込みも実行する実SQLiteに繋ぐ。
// SQL文字列を見るモックでは、DELETE が別会話の行まで巻き込む事実を観測できない。
const AUTH_TOKEN = "test-token";
const USER_EMAIL = "sukererion@gmail.com";
// ensureUser は userId としてメールをそのまま返す。
const USER_ID = USER_EMAIL;
const CHARACTER_ID = "char-1";
// greeting の INSERT だけを DB 側で確実に失敗させるための番兵。
const POISON_GREETING = "GREETING_INSERT_FAILS";

const makeRealD1 = (greeting: string) => {
  if (!DatabaseSyncCtor) {
    throw new Error("node:sqlite is not available");
  }
  const db = new DatabaseSyncCtor(":memory:");
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE character (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT,
      gender TEXT,
      system_prompt TEXT NOT NULL DEFAULT '', greeting TEXT NOT NULL DEFAULT '',
      user_persona_name TEXT, user_persona_gender TEXT, user_persona_personality TEXT,
      tags TEXT NOT NULL DEFAULT '[]', display_order INTEGER NOT NULL DEFAULT 0,
      is_official INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversation (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      title TEXT NOT NULL, parent_conversation_id TEXT, branched_from_message_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      rolling_summary TEXT, summary_updated_at INTEGER, sexual_state TEXT, scene_state TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      character_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL CHECK (content <> '${POISON_GREETING}'),
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
  `);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(USER_ID, USER_EMAIL);
  db.prepare(
    "INSERT INTO character (id, user_id, name, greeting, system_prompt) VALUES (?, ?, ?, ?, ?)",
  ).run(CHARACTER_ID, USER_ID, "テスト", greeting, "prompt");

  const wrap = (sql: string, args: unknown[]) => {
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const returnsRows = /^\s*select/i.test(sql) || /\breturning\b/i.test(sql);
    // RETURNING 付きの書き込みを二度実行せんよう、結果は一度だけ取って使い回す。
    let cached: Record<string, unknown>[] | undefined;
    const rows = (): Record<string, unknown>[] => {
      if (cached === undefined) {
        if (returnsRows) {
          cached = db.prepare(sql).all(...bound) as Record<string, unknown>[];
        } else {
          db.prepare(sql).run(...bound);
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
        return { success: true, meta: {}, results: [] };
      },
      raw: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
      values: async <T = unknown[]>() => rows().map((r) => Object.values(r)) as T[],
    };
  };

  const d1 = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => wrap(sql, args), ...wrap(sql, []) }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return { db, d1 };
};

const insertConversation = (db: DatabaseSync, id: string) => {
  db.prepare(
    "INSERT INTO conversation (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)",
  ).run(id, USER_ID, CHARACTER_ID, id);
};

const insertMessage = (db: DatabaseSync, id: string, conversationId: string, createdAt: number) => {
  db.prepare(
    "INSERT INTO message (id, user_id, conversation_id, character_id, role, content, created_at) VALUES (?, ?, ?, ?, 'user', ?, ?)",
  ).run(id, USER_ID, conversationId, CHARACTER_ID, id, createdAt);
};

const countMessages = (db: DatabaseSync, conversationId: string) =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM message WHERE conversation_id = ?")
      .get(conversationId) as { n: number }
  ).n;

describe.skipIf(!DatabaseSyncCtor)(
  "DELETE /api/conversations/:conversationId/messages-after/:messageId (実SQLite)",
  () => {
    it("別会話の messageId を渡されても、対象会話のメッセージを消さず 404 を返す", async () => {
      const { db, d1: DB } = makeRealD1("こんにちは");
      insertConversation(db, "conv-victim");
      insertConversation(db, "conv-other");
      insertMessage(db, "msg-victim-1", "conv-victim", 100);
      insertMessage(db, "msg-victim-2", "conv-victim", 200);
      insertMessage(db, "msg-victim-3", "conv-victim", 300);
      // conv-victim の全メッセージより古い pivot。会話で絞らんとこの3件が全部消える。
      insertMessage(db, "msg-other-old", "conv-other", 50);

      const response = await app.request(
        "/api/conversations/conv-victim/messages-after/msg-other-old",
        { method: "DELETE", headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
        { AUTH_TOKEN, DB },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "message not found" });
      expect(countMessages(db, "conv-victim")).toBe(3);
      expect(countMessages(db, "conv-other")).toBe(1);
    });

    it("同じ会話の messageId なら、それ以降のメッセージを消す", async () => {
      const { db, d1: DB } = makeRealD1("こんにちは");
      insertConversation(db, "conv-a");
      insertMessage(db, "msg-a-1", "conv-a", 100);
      insertMessage(db, "msg-a-2", "conv-a", 200);
      insertMessage(db, "msg-a-3", "conv-a", 300);

      const response = await app.request(
        "/api/conversations/conv-a/messages-after/msg-a-1",
        { method: "DELETE", headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
        { AUTH_TOKEN, DB },
      );

      expect(response.status).toBe(200);
      expect(countMessages(db, "conv-a")).toBe(1);
    });
  },
);

describe.skipIf(!DatabaseSyncCtor)("POST /api/conversations (実SQLite)", () => {
  it("greeting の保存に失敗したら、作りかけの会話行を残さない", async () => {
    const { db, d1: DB } = makeRealD1(POISON_GREETING);

    const response = await app.request(
      "/api/conversations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ characterId: CHARACTER_ID }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(500);
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM conversation").get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it("greeting が保存できれば、会話と greeting の両方が残る", async () => {
    const { db, d1: DB } = makeRealD1("おかえり");

    const response = await app.request(
      "/api/conversations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ characterId: CHARACTER_ID }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(201);
    const conversations = db.prepare("SELECT COUNT(*) AS n FROM conversation").get() as {
      n: number;
    };
    expect(conversations.n).toBe(1);
    const greetings = db
      .prepare("SELECT COUNT(*) AS n FROM message WHERE content = ?")
      .get("おかえり") as { n: number };
    expect(greetings.n).toBe(1);
  });
});
