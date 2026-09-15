// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできないため、このファイルだけ node 環境で走らせる。
import { describe, expect, it } from "vitest";

import { isValidShareId } from "../../../src/lib/conversation-share";
import { MAX_RESPONSE_PLAIN_CHARS } from "../../../src/lib/quality-guard";
import { app } from "../[[route]]";
import { SHARED_PAYLOAD_MESSAGE_LIMIT } from "../lib/route-context";

import type { DatabaseSync } from "node:sqlite";

let DatabaseSyncCtor: typeof DatabaseSync | undefined;
try {
  const mod = await import("node:sqlite");
  DatabaseSyncCtor = mod.DatabaseSync;
} catch {
  // この Node ビルドでは node:sqlite が無効化されている。
}

// share は「凍結した payload に何が入ったか」が仕様の本体なので、SQL 文字列を見る
// モックではなく実 SQLite に書かせて、保存された行そのものを読み返して検証する。
const AUTH_TOKEN = "test-token";
// ensureUser は userId としてメールをそのまま返す。
const OWNER_ID = "sukererion@gmail.com";
const STRANGER_ID = "stranger@example.com";
const CHARACTER_ID = "char-1";
// payload へ漏れてはいけないキャラの非公開フィールド。本文検索の番兵にする。
const SECRET_SYSTEM_PROMPT = "SYSTEM_PROMPT_MUST_NOT_LEAK";
const SECRET_GREETING = "GREETING_MUST_NOT_LEAK";
const SECRET_PERSONA = "PERSONA_MUST_NOT_LEAK";

const AUTH_HEADERS = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  "Content-Type": "application/json",
};

const makeRealD1 = () => {
  if (!DatabaseSyncCtor) {
    throw new Error("node:sqlite is not available");
  }
  const db = new DatabaseSyncCtor(":memory:");
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE character (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT,
      gender TEXT,
      is_official INTEGER NOT NULL DEFAULT 0, system_prompt TEXT NOT NULL DEFAULT '',
      visual_prompt TEXT, seed INTEGER, image_meta TEXT, lora_model TEXT,
      lora_weight REAL, lora_trigger_prompt TEXT, greeting TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', sub_avatars TEXT,
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
    CREATE TABLE conversation_share (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER
    );
  `);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(OWNER_ID, OWNER_ID);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(STRANGER_ID, STRANGER_ID);
  db.prepare(
    `INSERT INTO character
       (id, user_id, name, avatar, system_prompt, greeting, user_persona_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    CHARACTER_ID,
    OWNER_ID,
    "ミサキ",
    "avatar/misaki.webp",
    SECRET_SYSTEM_PROMPT,
    SECRET_GREETING,
    SECRET_PERSONA,
  );

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

const insertConversation = (
  db: DatabaseSync,
  id: string,
  options: { userId?: string; title?: string; characterId?: string } = {},
) => {
  db.prepare(
    "INSERT INTO conversation (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)",
  ).run(id, options.userId ?? OWNER_ID, options.characterId ?? CHARACTER_ID, options.title ?? id);
};

const insertMessage = (
  db: DatabaseSync,
  options: {
    id: string;
    conversationId: string;
    createdAt: number;
    content?: string;
    role?: string;
    userId?: string;
    imageUrl?: string | null;
  },
) => {
  db.prepare(
    `INSERT INTO message
       (id, user_id, conversation_id, character_id, role, content, image_url, raw_output, quality_meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    options.id,
    options.userId ?? OWNER_ID,
    options.conversationId,
    CHARACTER_ID,
    options.role ?? "user",
    options.content ?? options.id,
    options.imageUrl ?? null,
    "RAW_OUTPUT_MUST_NOT_LEAK",
    '{"score":42}',
    options.createdAt,
  );
};

const countShares = (db: DatabaseSync) =>
  (db.prepare("SELECT COUNT(*) AS n FROM conversation_share").get() as { n: number }).n;

// 「D1 を引いたか」だけを観測する軽量スタブ。常に 0 行を返す。
const makeCountingD1 = () => {
  const prepared: string[] = [];
  const statement = {
    all: () => Promise.resolve({ results: [], success: true }),
    first: () => Promise.resolve(null),
    run: () => Promise.resolve({ success: true, meta: {}, results: [] }),
    raw: () => Promise.resolve([]),
    values: () => Promise.resolve([]),
  };
  return {
    prepared,
    d1: {
      prepare: (sql: string) => {
        prepared.push(sql);
        return { bind: () => statement, ...statement };
      },
      dump: () => Promise.resolve(new ArrayBuffer(0)),
      batch: () => Promise.resolve([]),
      exec: () => Promise.resolve({ count: 0, duration: 0 }),
    },
  };
};

type D1Stub = ReturnType<typeof makeRealD1>["d1"] | ReturnType<typeof makeCountingD1>["d1"];

const postShare = (DB: D1Stub, body: unknown, options: { auth?: boolean } = {}) =>
  app.request(
    "/api/share",
    {
      method: "POST",
      headers: options.auth === false ? { "Content-Type": "application/json" } : AUTH_HEADERS,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    { AUTH_TOKEN, DB },
  );

// 認証ヘッダを一切付けずに叩く。公開読み取りが本当に無認証で通ることの確認になる。
const getShare = (DB: D1Stub, shareId: string) =>
  app.request(`/api/share/${shareId}`, {}, { AUTH_TOKEN, DB });

const deleteShare = (DB: D1Stub, shareId: string, options: { auth?: boolean } = {}) =>
  app.request(
    `/api/share/${shareId}`,
    {
      method: "DELETE",
      headers: options.auth === false ? {} : AUTH_HEADERS,
    },
    { AUTH_TOKEN, DB },
  );

// response.json() の戻りは unknown なので、期待する形へ寄せてから assert する。
const readJson = async <T>(response: Response): Promise<T> => {
  const body: unknown = await response.json();
  return body as T;
};

type SharedMessage = {
  id: string;
  role: string;
  content: string;
  imageUrl: string | null;
  createdAt: number;
};

type SharedPayloadBody = {
  conversationId: string;
  title: string | null;
  character: { id: string; name: string; avatar: string | null };
  messages: SharedMessage[];
  now: number;
};

describe.skipIf(!DatabaseSyncCtor)("POST /api/share (実SQLite)", () => {
  it("認証なしなら 401 を返し、共有行を作らない", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");

    const response = await postShare(DB, { conversationId: "conv-a" }, { auth: false });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countShares(db)).toBe(0);
  });

  it("他人の会話 ID を渡されても 404 で、共有行を作らない", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-stranger", { userId: STRANGER_ID });
    insertMessage(db, { id: "m1", conversationId: "conv-stranger", createdAt: 100 });

    const response = await postShare(DB, { conversationId: "conv-stranger" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation_not_found" });
    expect(countShares(db)).toBe(0);
  });

  it("存在しない会話 ID も、他人の会話と同じ 404 で区別できない", async () => {
    const { db, d1: DB } = makeRealD1();

    const response = await postShare(DB, { conversationId: "conv-nope" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation_not_found" });
    expect(countShares(db)).toBe(0);
  });

  it.each([
    ["conversationId が無い", {}],
    ["conversationId が空文字", { conversationId: "" }],
    ["conversationId が 129 文字", { conversationId: "x".repeat(129) }],
    ["conversationId が文字列でない", { conversationId: 123 }],
  ])("%s なら 400 で、共有行を作らない", async (_label, body) => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");

    const response = await postShare(DB, body);

    expect(response.status).toBe(400);
    expect(countShares(db)).toBe(0);
  });

  it("128 文字ちょうどの conversationId は validator を通り、404 まで到達する", async () => {
    const { db, d1: DB } = makeRealD1();

    const response = await postShare(DB, { conversationId: "x".repeat(128) });

    expect(response.status).toBe(404);
    expect(countShares(db)).toBe(0);
  });

  it("自分の会話なら shareId を発行し、所有者付きの行を 1 件だけ保存する", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a", { title: "夜の続き" });
    insertMessage(db, { id: "m1", conversationId: "conv-a", createdAt: 100 });

    const response = await postShare(DB, { conversationId: "conv-a" });

    expect(response.status).toBe(200);
    const body = await readJson<{ shareId: string; createdAt: number; expiresAt: number }>(
      response,
    );
    expect(Object.keys(body).sort()).toEqual(["createdAt", "expiresAt", "shareId"]);
    // shareId は URL 自体がトークンなので、GET 側の受理条件を満たす形式でなければ即死ぬ。
    expect(isValidShareId(body.shareId)).toBe(true);

    const row = db
      .prepare("SELECT id, conversation_id, user_id, created_at FROM conversation_share")
      .get() as { id: string; conversation_id: string; user_id: string; created_at: number };
    expect(row.id).toBe(body.shareId);
    expect(row.conversation_id).toBe("conv-a");
    expect(row.user_id).toBe(OWNER_ID);
    expect(row.created_at).toBe(body.createdAt);
    expect(countShares(db)).toBe(1);
  });

  it("payload には意図した項目だけが入り、他会話・他人・キャラ非公開項目を含まない", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a", { title: "共有する会話" });
    insertMessage(db, {
      id: "m1",
      conversationId: "conv-a",
      createdAt: 100,
      content: "こんばんは",
    });
    insertMessage(db, {
      id: "m2",
      conversationId: "conv-a",
      createdAt: 200,
      role: "assistant",
      content: "おかえり",
      imageUrl: "https://example.test/a.webp",
    });
    // 同じ所有者の別会話。payload へ混ざったら共有範囲の破れ。
    insertConversation(db, "conv-other", { title: "共有せん会話" });
    insertMessage(db, {
      id: "m-other",
      conversationId: "conv-other",
      createdAt: 150,
      content: "OTHER_CONVERSATION_SECRET",
    });
    // conversationId は一致するが所有者が違う行。userId 条件が落ちたらここが漏れる。
    insertMessage(db, {
      id: "m-foreign",
      conversationId: "conv-a",
      createdAt: 160,
      userId: STRANGER_ID,
      content: "FOREIGN_USER_SECRET",
    });

    const response = await postShare(DB, { conversationId: "conv-a" });
    expect(response.status).toBe(200);
    const { shareId } = await readJson<{ shareId: string }>(response);

    const stored = db
      .prepare("SELECT payload FROM conversation_share WHERE id = ?")
      .get(shareId) as { payload: string };
    const payload = JSON.parse(stored.payload) as SharedPayloadBody;

    expect(Object.keys(payload).sort()).toEqual([
      "character",
      "conversationId",
      "messages",
      "now",
      "title",
    ]);
    expect(payload.conversationId).toBe("conv-a");
    expect(payload.title).toBe("共有する会話");
    expect(payload.character).toEqual({
      id: CHARACTER_ID,
      name: "ミサキ",
      avatar: "avatar/misaki.webp",
    });
    expect(payload.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(payload.messages[1]).toEqual({
      id: "m2",
      role: "assistant",
      content: "おかえり",
      imageUrl: "https://example.test/a.webp",
      createdAt: 200,
    });
    for (const message of payload.messages) {
      expect(Object.keys(message).sort()).toEqual([
        "content",
        "createdAt",
        "id",
        "imageUrl",
        "role",
      ]);
    }
    // 番兵の全文検索。項目名を増やしただけの漏れも本文一致で捕まえる。
    for (const secret of [
      OWNER_ID,
      STRANGER_ID,
      SECRET_SYSTEM_PROMPT,
      SECRET_GREETING,
      SECRET_PERSONA,
      "RAW_OUTPUT_MUST_NOT_LEAK",
      "OTHER_CONVERSATION_SECRET",
      "FOREIGN_USER_SECRET",
      "共有せん会話",
    ]) {
      expect(stored.payload).not.toContain(secret);
    }
  });

  it("キャラ行が引けない会話でも 200 で、name は AI・avatar は null にフォールバックする", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a", { characterId: "char-missing" });
    insertMessage(db, { id: "m1", conversationId: "conv-a", createdAt: 100 });

    const response = await postShare(DB, { conversationId: "conv-a" });

    expect(response.status).toBe(200);
    const { shareId } = await readJson<{ shareId: string }>(response);
    const stored = db
      .prepare("SELECT payload FROM conversation_share WHERE id = ?")
      .get(shareId) as { payload: string };
    const payload = JSON.parse(stored.payload) as SharedPayloadBody;
    expect(payload.character).toEqual({ id: "char-missing", name: "AI", avatar: null });
  });

  it("メッセージが 0 件の会話でも 200 で、messages は空配列になる", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-empty");

    const response = await postShare(DB, { conversationId: "conv-empty" });

    expect(response.status).toBe(200);
    const { shareId } = await readJson<{ shareId: string }>(response);
    const stored = db
      .prepare("SELECT payload FROM conversation_share WHERE id = ?")
      .get(shareId) as { payload: string };
    expect((JSON.parse(stored.payload) as SharedPayloadBody).messages).toEqual([]);
  });

  it("上限を超える件数でも、新しい方から上限件数だけを昇順のまま凍結する", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-long");
    const total = SHARED_PAYLOAD_MESSAGE_LIMIT + 2;
    for (let index = 0; index < total; index += 1) {
      insertMessage(db, {
        id: `m-${String(index).padStart(3, "0")}`,
        conversationId: "conv-long",
        createdAt: 1000 + index,
      });
    }

    const response = await postShare(DB, { conversationId: "conv-long" });
    expect(response.status).toBe(200);
    const { shareId } = await readJson<{ shareId: string }>(response);
    const stored = db
      .prepare("SELECT payload FROM conversation_share WHERE id = ?")
      .get(shareId) as { payload: string };
    const payload = JSON.parse(stored.payload) as SharedPayloadBody;

    expect(payload.messages).toHaveLength(SHARED_PAYLOAD_MESSAGE_LIMIT);
    // 古い方を捨てて新しい 500 件が残る。DESC 取得後の reverse が抜けると先頭が m-501 になる。
    expect(payload.messages[0].id).toBe("m-002");
    expect(payload.messages.at(-1)?.id).toBe(`m-${String(total - 1).padStart(3, "0")}`);
    expect(payload.messages.map((m) => m.createdAt)).toEqual(
      [...payload.messages].sort((a, b) => a.createdAt - b.createdAt).map((m) => m.createdAt),
    );
  });

  // share.ts の 500 件上限は「D1 の 1MB 上限に収めるため」と説明されとるが、件数では
  // バイト数を縛れん。本番の応答上限 MAX_RESPONSE_PLAIN_CHARS=2,200 文字の日本語は
  // UTF-8 で約 6,600 バイトあるので、200 件（=上限の半分未満）で 900KB を超える。
  // バイト上限に収まるよう古いメッセージから削り、共有できるようになった。
  it("件数上限に達しとらんでも 900KB を超える場合は古いメッセージを削って共有できる", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-huge");
    const longJapaneseReply = "あ".repeat(MAX_RESPONSE_PLAIN_CHARS);
    const messageCount = 200;
    for (let index = 0; index < messageCount; index += 1) {
      insertMessage(db, {
        id: `m-${index}`,
        conversationId: "conv-huge",
        createdAt: 1000 + index,
        role: "assistant",
        content: longJapaneseReply,
      });
    }

    const response = await postShare(DB, { conversationId: "conv-huge" });

    expect(response.status).toBe(200);
    const { shareId } = await readJson<{ shareId: string }>(response);
    expect(countShares(db)).toBe(1);
    const stored = db
      .prepare("SELECT payload FROM conversation_share WHERE id = ?")
      .get(shareId) as { payload: string };
    const payload = JSON.parse(stored.payload) as SharedPayloadBody;
    expect(payload.messages.length).toBeLessThan(messageCount);
    // 新しいメッセージが残る（古い m-0 は削られる）。
    expect(payload.messages[0].id).not.toBe("m-0");
    expect(messageCount).toBeLessThan(SHARED_PAYLOAD_MESSAGE_LIMIT);
  });
});

describe.skipIf(!DatabaseSyncCtor)("POST /api/share burst 制限 (実SQLite)", () => {
  it("10 秒以内の 2 回目は 429 + Retry-After で、2 件目を保存しない", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");
    insertConversation(db, "conv-b");

    expect((await postShare(DB, { conversationId: "conv-a" })).status).toBe(200);
    const second = await postShare(DB, { conversationId: "conv-b" });

    expect(second.status).toBe(429);
    const body = await readJson<{ error: string; retryAfterSec: number }>(second);
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(body.retryAfterSec).toBeLessThanOrEqual(10);
    expect(second.headers.get("Retry-After")).toBe(String(body.retryAfterSec));
    expect(countShares(db)).toBe(1);
  });

  it("burst 制限は所有者ごとで、他人の直近共有では止まらない", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("11111111-1111-4111-8111-111111111111", "conv-a", STRANGER_ID, "{}", Date.now());

    const response = await postShare(DB, { conversationId: "conv-a" });

    expect(response.status).toBe(200);
    expect(countShares(db)).toBe(2);
  });

  it("直近の共有が 10 秒より古ければ再び共有できる", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("22222222-2222-4222-8222-222222222222", "conv-a", OWNER_ID, "{}", Date.now() - 10_001);

    const response = await postShare(DB, { conversationId: "conv-a" });

    expect(response.status).toBe(200);
    expect(countShares(db)).toBe(2);
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/share/:shareId (実SQLite)", () => {
  it("認証なしで 200 を返し、凍結済み payload をそのまま公開する", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a", { title: "共有する会話" });
    insertMessage(db, {
      id: "m1",
      conversationId: "conv-a",
      createdAt: 100,
      content: "こんばんは",
    });
    const created = await postShare(DB, { conversationId: "conv-a" });
    const { shareId, createdAt } = await readJson<{ shareId: string; createdAt: number }>(created);

    const response = await getShare(DB, shareId);

    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as {
      shareId: string;
      createdAt: number;
      expiresAt: number;
      payload: SharedPayloadBody;
    };
    expect(Object.keys(body).sort()).toEqual(["createdAt", "expiresAt", "payload", "shareId"]);
    expect(body.shareId).toBe(shareId);
    expect(body.createdAt).toBe(createdAt);
    expect(body.payload.messages.map((m) => m.content)).toEqual(["こんばんは"]);
    for (const secret of [OWNER_ID, SECRET_SYSTEM_PROMPT, SECRET_GREETING, SECRET_PERSONA]) {
      expect(text).not.toContain(secret);
    }
  });

  it("他人が作った共有でも、shareId を知っていれば無認証で読める（URL がトークン）", async () => {
    const { db, d1: DB } = makeRealD1();
    const shareId = "33333333-3333-4333-8333-333333333333";
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(shareId, "conv-stranger", STRANGER_ID, JSON.stringify({ messages: [] }), 777);

    const response = await getShare(DB, shareId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      shareId,
      createdAt: 777,
      expiresAt: null,
      payload: { messages: [] },
    });
  });

  it("共有後に会話へ追記しても、凍結された時点の内容しか返さない", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");
    insertMessage(db, { id: "m1", conversationId: "conv-a", createdAt: 100, content: "凍結前" });
    const { shareId } = await readJson<{ shareId: string }>(
      await postShare(DB, { conversationId: "conv-a" }),
    );
    insertMessage(db, { id: "m2", conversationId: "conv-a", createdAt: 200, content: "凍結後" });

    const response = await getShare(DB, shareId);

    expect(response.status).toBe(200);
    const body = await readJson<{ payload: SharedPayloadBody }>(response);
    expect(body.payload.messages.map((m) => m.content)).toEqual(["凍結前"]);
  });

  // 共有 payload は元メッセージの独立コピーなので、元を消しても公開 URL からは読めたまま。
  // share を取り消す API は存在せず（conversationShareTable の DELETE は会話削除と
  // ユーザー全削除の 2 経路のみ）、GET 側も createdAt を期限判定に使っとらん。
  it("元メッセージを削除しても、共有スナップショットは読めたまま残る", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");
    insertMessage(db, {
      id: "m1",
      conversationId: "conv-a",
      createdAt: 100,
      content: "消した本文",
    });
    const { shareId } = await readJson<{ shareId: string }>(
      await postShare(DB, { conversationId: "conv-a" }),
    );
    db.prepare("DELETE FROM message WHERE conversation_id = ?").run("conv-a");

    const response = await getShare(DB, shareId);

    expect(response.status).toBe(200);
    const body = await readJson<{ payload: SharedPayloadBody }>(response);
    expect(body.payload.messages.map((m) => m.content)).toEqual(["消した本文"]);
  });

  // 形式違反も DB ミスも同じ 404 なので、status だけ見ても isValidShareId が
  // 生きとるか判別でけへん。DB へ触れたかどうかで前段の門を観測する。
  it.each([
    ["UUID 形式でない", "not-a-uuid"],
    ["長さが 36 でない", "1234567890"],
    ["ハイフン位置が違う", "111111111-111-4111-8111-11111111111"],
    ["16 進数でない文字を含む", "gggggggg-1111-4111-8111-111111111111"],
    ["大文字 16 進数", "AAAAAAAA-1111-4111-8111-111111111111"],
    ["36 文字だが末尾が改行", `${"1".repeat(8)}-1111-4111-8111-${"1".repeat(11)}\n`],
  ])("%s shareId は D1 を引かずに 404 で弾く", async (_label, shareId) => {
    const counting = makeCountingD1();

    const response = await getShare(counting.d1, encodeURIComponent(shareId));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(counting.prepared).toHaveLength(0);
  });

  it("形式は正しいが存在しない shareId は、D1 を引いた上で 404", async () => {
    const counting = makeCountingD1();

    const response = await getShare(counting.d1, "44444444-4444-4444-8444-444444444444");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    // 同じ 404 でも DB 参照の有無が違う。前段の門が消えたらここと上のテストが同じ挙動になる。
    expect(counting.prepared.length).toBeGreaterThan(0);
  });

  it("payload が壊れている行は 410 payload_corrupt を返す", async () => {
    const { db, d1: DB } = makeRealD1();
    const shareId = "55555555-5555-4555-8555-555555555555";
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(shareId, "conv-a", OWNER_ID, "{壊れたJSON", 100);

    const response = await getShare(DB, shareId);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "payload_corrupt" });
  });

  it("expires_at を過ぎとったら 410 share_expired を返す", async () => {
    const { db, d1: DB } = makeRealD1();
    const shareId = "66666666-6666-4666-8666-666666666666";
    const past = Date.now() - 1;
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(shareId, "conv-a", OWNER_ID, JSON.stringify({ messages: [] }), past - 1, past);

    const response = await getShare(DB, shareId);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "share_expired" });
  });
});

describe.skipIf(!DatabaseSyncCtor)("DELETE /api/share/:shareId (実SQLite)", () => {
  it("未認証なら 401", async () => {
    const { d1: DB } = makeRealD1();

    const response = await deleteShare(DB, "11111111-1111-4111-8111-111111111111", { auth: false });

    expect(response.status).toBe(401);
  });

  it("他人の share は 404 で消さん", async () => {
    const { db, d1: DB } = makeRealD1();
    const shareId = "77777777-7777-4777-8777-777777777777";
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(shareId, "conv-a", STRANGER_ID, JSON.stringify({ messages: [] }), 100);

    const response = await deleteShare(DB, shareId);

    expect(response.status).toBe(404);
    expect(countShares(db)).toBe(1);
  });

  it("自分の share は 200 {ok:true} で消える", async () => {
    const { db, d1: DB } = makeRealD1();
    insertConversation(db, "conv-a");
    const { shareId } = await readJson<{ shareId: string }>(
      await postShare(DB, { conversationId: "conv-a" }),
    );

    const response = await deleteShare(DB, shareId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(countShares(db)).toBe(0);
  });

  it("存在しない share は 404", async () => {
    const { d1: DB } = makeRealD1();

    const response = await deleteShare(DB, "88888888-8888-4888-8888-888888888888");

    expect(response.status).toBe(404);
  });
});
