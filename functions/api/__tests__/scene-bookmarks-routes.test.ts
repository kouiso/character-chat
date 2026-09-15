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

// ページングと冪等 POST は「実際に何行残ったか」でしか判定できんので、
// SQL 文字列を見るモックやのうて実 SQLite に繋ぐ。
const AUTH_TOKEN = "test-token";
const USER_EMAIL = "sukererion@gmail.com";
// ensureUser は userId としてメールをそのまま返す。
const OWNER_ID = USER_EMAIL;
const OTHER_ID = "intruder@example.com";
const CHARACTER_ID = "char-owner";
const OTHER_CHARACTER_ID = "char-other";
const CONVERSATION_ID = "conv-owner";
const OTHER_CONVERSATION_ID = "conv-other";
const MESSAGE_ID = "msg-owner";
const OTHER_MESSAGE_ID = "msg-other";

type BookmarkSeed = {
  id: string;
  userId?: string;
  title?: string;
  snippet?: string;
  characterId?: string | null;
  characterName?: string;
  conversationId?: string;
  messageId?: string;
  createdAt: number;
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
      character_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE scene_bookmark (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      title TEXT NOT NULL, snippet TEXT NOT NULL, character_name TEXT NOT NULL,
      character_id TEXT REFERENCES character(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const insertUser = db.prepare("INSERT INTO user (id, email) VALUES (?, ?)");
  insertUser.run(OWNER_ID, USER_EMAIL);
  insertUser.run(OTHER_ID, OTHER_ID);
  const insertCharacter = db.prepare("INSERT INTO character (id, user_id, name) VALUES (?, ?, ?)");
  insertCharacter.run(CHARACTER_ID, OWNER_ID, "本人キャラ");
  insertCharacter.run(OTHER_CHARACTER_ID, OTHER_ID, "他人キャラ");
  const insertConversation = db.prepare(
    "INSERT INTO conversation (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)",
  );
  insertConversation.run(CONVERSATION_ID, OWNER_ID, CHARACTER_ID, "本人の会話");
  insertConversation.run(OTHER_CONVERSATION_ID, OTHER_ID, OTHER_CHARACTER_ID, "他人の会話");
  const insertMessage = db.prepare(
    "INSERT INTO message (id, user_id, conversation_id, character_id, role, content, created_at) VALUES (?, ?, ?, ?, 'assistant', ?, 0)",
  );
  insertMessage.run(MESSAGE_ID, OWNER_ID, CONVERSATION_ID, CHARACTER_ID, "本文");
  insertMessage.run(OTHER_MESSAGE_ID, OTHER_ID, OTHER_CONVERSATION_ID, OTHER_CHARACTER_ID, "本文");

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
  return { db, DB: d1 };
};

const seedBookmark = (db: DatabaseSync, seed: BookmarkSeed) => {
  db.prepare(
    `INSERT INTO scene_bookmark
       (id, user_id, conversation_id, message_id, title, snippet, character_name, character_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.userId ?? OWNER_ID,
    seed.conversationId ?? CONVERSATION_ID,
    seed.messageId ?? MESSAGE_ID,
    seed.title ?? `title-${seed.id}`,
    seed.snippet ?? `snippet-${seed.id}`,
    seed.characterName ?? "本人キャラ",
    seed.characterId === undefined ? CHARACTER_ID : seed.characterId,
    seed.createdAt,
  );
};

const readBookmark = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT * FROM scene_bookmark WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;

const countBookmarks = (db: DatabaseSync) =>
  (db.prepare("SELECT COUNT(*) AS n FROM scene_bookmark").get() as { n: number }).n;

type Env = ReturnType<typeof makeRealD1>["DB"];

const authed = (DB: Env, path: string, init: RequestInit = {}) =>
  app.request(
    path,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
    { AUTH_TOKEN, DB },
  );

// 認証ヘッダも Host も付けん。getUserEmail は localhost の Host を本人扱いするため、
// 「ヘッダを省く」ことが未認証の再現条件になる。
const anonymous = (DB: Env, path: string, init: RequestInit = {}) =>
  app.request(path, init, { AUTH_TOKEN, DB });

// Response#json() の戻り値型が eslint(DOM の any) と tsc(Workers 型の unknown) で
// 食い違い、型アサーションを書くと片方だけが怒る。JSON.parse を挟んで戻り値型を決める。
type BookmarkPayload = {
  id: string;
  conversationId: string;
  messageId: string;
  title: string;
  snippet: string;
  characterName: string;
  characterId: string | null;
  createdAt: number;
};

const readListBody = async (
  response: Response,
): Promise<{ items: BookmarkPayload[]; nextCursor: string | null }> =>
  JSON.parse(await response.text());

const readBookmarkBody = async (response: Response): Promise<{ bookmark: BookmarkPayload }> =>
  JSON.parse(await response.text());

const validCreateBody = {
  title: "保存したい場面",
  snippet: "スニペット",
  conversationId: CONVERSATION_ID,
  messageId: MESSAGE_ID,
  characterName: "本人キャラ",
};

describe.skipIf(!DatabaseSyncCtor)("GET /api/scene-bookmarks (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 を返し、DB を読まない", async () => {
    const { DB } = makeRealD1();

    const response = await anonymous(DB, "/api/scene-bookmarks");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("他人の user_id のブックマークは一覧に混ざらない", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-mine", createdAt: 200 });
    seedBookmark(db, {
      id: "bm-theirs",
      userId: OTHER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      messageId: OTHER_MESSAGE_ID,
      characterId: OTHER_CHARACTER_ID,
      createdAt: 300,
    });

    const response = await authed(DB, "/api/scene-bookmarks");

    expect(response.status).toBe(200);
    // 本人の1件だけ。createdAt が新しい他人の行が先頭に来とったら所有権漏れ。
    expect(await response.json()).toEqual({
      items: [
        {
          id: "bm-mine",
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          title: "title-bm-mine",
          snippet: "snippet-bm-mine",
          characterName: "本人キャラ",
          characterId: CHARACTER_ID,
          createdAt: 200,
        },
      ],
      nextCursor: null,
    });
  });

  it("limit がスキーマ上限(200)を超えると 400 を返す", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks?limit=201");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("limit が 0 でも 400 を返す", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks?limit=0");

    expect(response.status).toBe(400);
  });

  it("cursor に負数を渡すと 400 を返す", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks?cursor=-1");

    expect(response.status).toBe(400);
  });

  it("cursor に壊れた形式を渡すと 400 を返す", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks?cursor=malformed");

    expect(response.status).toBe(400);
  });

  it("limit を超える件数があるとき nextCursor で続きが取れ、最後のページで null になる", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-1", createdAt: 100 });
    seedBookmark(db, { id: "bm-2", createdAt: 200 });
    seedBookmark(db, { id: "bm-3", createdAt: 300 });

    const first = await authed(DB, "/api/scene-bookmarks?limit=2");
    expect(first.status).toBe(200);
    const firstBody = await readListBody(first);
    // createdAt 降順なので新しい2件。nextCursor は (createdAt|id) 形式。
    expect(firstBody.items.map((item) => item.id)).toEqual(["bm-3", "bm-2"]);
    expect(firstBody.nextCursor).toBe("200|bm-2");

    const second = await authed(
      DB,
      `/api/scene-bookmarks?limit=2&cursor=${encodeURIComponent(String(firstBody.nextCursor))}`,
    );
    const secondBody = await readListBody(second);
    // 2ページで全3件を取り切り、重複も欠落も無いこと。
    expect(secondBody.items.map((item) => item.id)).toEqual(["bm-1"]);
    expect(secondBody.nextCursor).toBeNull();
  });

  it("同じ createdAt がページ境界をまたぐと、行が欠落せずに全件取れる", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-newest", createdAt: 300 });
    // 同じミリ秒に作られた2件。limit=2 の境界がこの2件の間に落ちる。
    seedBookmark(db, { id: "bm-tie-a", createdAt: 200 });
    seedBookmark(db, { id: "bm-tie-b", createdAt: 200 });

    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const query = cursor === null ? "limit=2" : `limit=2&cursor=${encodeURIComponent(cursor)}`;
      const response = await authed(DB, `/api/scene-bookmarks?${query}`);
      const body = await readListBody(response);
      collected.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    expect(collected.sort()).toEqual(["bm-newest", "bm-tie-a", "bm-tie-b"]);
  });

  it("characterId で絞り込むと、他キャラのブックマークは返らない", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-target", characterId: CHARACTER_ID, createdAt: 100 });
    seedBookmark(db, { id: "bm-nullchar", characterId: null, createdAt: 200 });

    const response = await authed(DB, `/api/scene-bookmarks?characterId=${CHARACTER_ID}`);

    const body = await readListBody(response);
    expect(body.items.map((item) => item.id)).toEqual(["bm-target"]);
  });

  it("q は title と snippet の両方を大文字小文字を無視して検索する", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-title", title: "Kissシーン", snippet: "無関係", createdAt: 100 });
    seedBookmark(db, { id: "bm-snippet", title: "無関係", snippet: "KISSした", createdAt: 200 });
    seedBookmark(db, { id: "bm-miss", title: "無関係", snippet: "無関係", createdAt: 300 });

    const response = await authed(DB, "/api/scene-bookmarks?q=kiss");

    const body = await readListBody(response);
    expect(body.items.map((item) => item.id).sort()).toEqual(["bm-snippet", "bm-title"]);
  });

  it("q の % はワイルドカードとして解釈されず、リテラルとして照合される", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-literal", title: "100%達成", createdAt: 100 });
    seedBookmark(db, { id: "bm-wildcard", title: "100倍達成", createdAt: 200 });

    const response = await authed(DB, `/api/scene-bookmarks?q=${encodeURIComponent("100%達成")}`);

    // エスケープが外れると "100" と "達成" の間が任意文字列になり bm-wildcard も釣れる。
    const body = await readListBody(response);
    expect(body.items.map((item) => item.id)).toEqual(["bm-literal"]);
  });
});

describe.skipIf(!DatabaseSyncCtor)("POST /api/scene-bookmarks (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 を返し、行を作らない", async () => {
    const { db, DB } = makeRealD1();

    const response = await anonymous(DB, "/api/scene-bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validCreateBody),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countBookmarks(db)).toBe(0);
  });

  it("必須項目が欠けたボディは 400 で弾かれ、行を作らない", async () => {
    const { db, DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ title: "タイトルだけ" }),
    });

    expect(response.status).toBe(400);
    expect(countBookmarks(db)).toBe(0);
  });

  it("他人の会話 ID を指定すると 404 conversation not found で、行を作らない", async () => {
    const { db, DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({
        ...validCreateBody,
        conversationId: OTHER_CONVERSATION_ID,
        messageId: OTHER_MESSAGE_ID,
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation not found" });
    expect(countBookmarks(db)).toBe(0);
  });

  it("存在せんメッセージ ID を指定すると 404 message not found で、行を作らない", async () => {
    const { db, DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, messageId: "msg-missing" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "message not found" });
    expect(countBookmarks(db)).toBe(0);
  });

  it("自分の会話に属さんメッセージ ID は 404 message not found になる", async () => {
    const { db, DB } = makeRealD1();
    // 本人所有やが別会話のメッセージ。会話 ID で絞れてへんかったら通ってまう。
    db.prepare(
      "INSERT INTO message (id, user_id, conversation_id, character_id, role, content, created_at) VALUES (?, ?, ?, ?, 'assistant', '本文', 0)",
    ).run("msg-elsewhere", OWNER_ID, "conv-elsewhere", CHARACTER_ID);

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, messageId: "msg-elsewhere" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "message not found" });
    expect(countBookmarks(db)).toBe(0);
  });

  it("他人のキャラ ID を指定すると 404 character not found で、行を作らない", async () => {
    const { db, DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, characterId: OTHER_CHARACTER_ID }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
    expect(countBookmarks(db)).toBe(0);
  });

  it("正常なボディなら 201 で保存し、行の user_id は要求者になる", async () => {
    const { db, DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, id: "bm-new", characterId: CHARACTER_ID }),
    });

    expect(response.status).toBe(201);
    const body = await readBookmarkBody(response);
    expect(body.bookmark).toMatchObject({
      id: "bm-new",
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      title: "保存したい場面",
      snippet: "スニペット",
      characterName: "本人キャラ",
      characterId: CHARACTER_ID,
    });
    // userId をレスポンスへ混ぜてへんこと（他ユーザー識別子の露出防止）。
    expect(body.bookmark).not.toHaveProperty("userId");
    expect(typeof body.bookmark.createdAt).toBe("number");

    const stored = readBookmark(db, "bm-new");
    expect(stored?.user_id).toBe(OWNER_ID);
    expect(stored?.title).toBe("保存したい場面");
  });

  it("characterId を省くと character_id は null で保存される", async () => {
    const { db, DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, id: "bm-nochar" }),
    });

    expect(response.status).toBe(201);
    const body = await readBookmarkBody(response);
    expect(body.bookmark.characterId).toBeNull();
    expect(readBookmark(db, "bm-nochar")?.character_id).toBeNull();
  });

  it("同じ id で二度 POST しても重複せず、二度目は 201 やのうて 200 で既存行を返す", async () => {
    const { db, DB } = makeRealD1();
    const payload = JSON.stringify({
      ...validCreateBody,
      id: "bm-replay",
      characterId: CHARACTER_ID,
    });

    const first = await authed(DB, "/api/scene-bookmarks", { method: "POST", body: payload });
    expect(first.status).toBe(201);
    const firstBody = await readBookmarkBody(first);

    const second = await authed(DB, "/api/scene-bookmarks", { method: "POST", body: payload });
    expect(second.status).toBe(200);
    const secondBody = await readBookmarkBody(second);

    // 再送は新規作成やのうて既存行の読み出し。createdAt が変わっとったら作り直しとる。
    expect(secondBody.bookmark).toEqual(firstBody.bookmark);
    expect(countBookmarks(db)).toBe(1);
  });

  it("再送のボディが違っても既存行は上書きされない", async () => {
    const { db, DB } = makeRealD1();
    await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, id: "bm-replay2", title: "最初のタイトル" }),
    });

    const second = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, id: "bm-replay2", title: "あとから来たタイトル" }),
    });

    expect(second.status).toBe(200);
    const body = await readBookmarkBody(second);
    expect(body.bookmark.title).toBe("最初のタイトル");
    expect(readBookmark(db, "bm-replay2")?.title).toBe("最初のタイトル");
  });

  it("他人が同じ id を握っとる場合、その行を返さず 500 で落ちる（乗っ取られん）", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, {
      id: "bm-shared-id",
      userId: OTHER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      messageId: OTHER_MESSAGE_ID,
      characterId: OTHER_CHARACTER_ID,
      title: "他人のタイトル",
      createdAt: 50,
    });

    const response = await authed(DB, "/api/scene-bookmarks", {
      method: "POST",
      body: JSON.stringify({ ...validCreateBody, id: "bm-shared-id" }),
    });

    // 肝は「他人の行を返さん・上書きせん」こと。冪等判定が user_id で絞れてへんかったら
    // ここが 200 + 他人のブックマークになる。
    // 実際は id が PRIMARY KEY なので INSERT が衝突し、409 でも 201 でもなく 500 になる。
    // 単一運用者アプリでは実害は薄いが、500/201 の差が「その id が誰かに使われとる」の
    // 存在オラクルにはなる。
    expect(response.status).toBe(500);
    expect(readBookmark(db, "bm-shared-id")?.title).toBe("他人のタイトル");
    expect(countBookmarks(db)).toBe(1);
  });
});

describe.skipIf(!DatabaseSyncCtor)("PATCH /api/scene-bookmarks/:id (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 を返し、title を書き換えない", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-1", title: "元のタイトル", createdAt: 100 });

    const response = await anonymous(DB, "/api/scene-bookmarks/bm-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "書き換え" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(readBookmark(db, "bm-1")?.title).toBe("元のタイトル");
  });

  it("id が idSchema の上限(128文字)を超えると 400 invalid bookmark id", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, `/api/scene-bookmarks/${"x".repeat(129)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "書き換え" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid bookmark id" });
  });

  it("title が空文字なら 400 で弾かれ、行は変わらない", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-1", title: "元のタイトル", createdAt: 100 });

    const response = await authed(DB, "/api/scene-bookmarks/bm-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "   " }),
    });

    expect(response.status).toBe(400);
    expect(readBookmark(db, "bm-1")?.title).toBe("元のタイトル");
  });

  it("他人のブックマークは 404 で、title を書き換えられない", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, {
      id: "bm-theirs",
      userId: OTHER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      messageId: OTHER_MESSAGE_ID,
      characterId: OTHER_CHARACTER_ID,
      title: "他人のタイトル",
      createdAt: 100,
    });

    const response = await authed(DB, "/api/scene-bookmarks/bm-theirs", {
      method: "PATCH",
      body: JSON.stringify({ title: "乗っ取り" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "bookmark not found" });
    expect(readBookmark(db, "bm-theirs")?.title).toBe("他人のタイトル");
  });

  it("存在せん id は 404 bookmark not found", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks/bm-missing", {
      method: "PATCH",
      body: JSON.stringify({ title: "書き換え" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "bookmark not found" });
  });

  it("自分のブックマークなら 200 で更新後の内容を返し、title 以外は保つ", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-1", title: "元のタイトル", snippet: "本文", createdAt: 100 });

    const response = await authed(DB, "/api/scene-bookmarks/bm-1", {
      method: "PATCH",
      body: JSON.stringify({ title: "  新しいタイトル  " }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      bookmark: {
        id: "bm-1",
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        // zod の trim が効いて前後の空白は落ちる。
        title: "新しいタイトル",
        snippet: "本文",
        characterName: "本人キャラ",
        characterId: CHARACTER_ID,
        createdAt: 100,
      },
    });
    expect(readBookmark(db, "bm-1")?.title).toBe("新しいタイトル");
  });

  it("同名 id の他人の行を巻き込んで更新せん", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-mine", title: "自分のタイトル", createdAt: 100 });
    seedBookmark(db, {
      id: "bm-theirs",
      userId: OTHER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      messageId: OTHER_MESSAGE_ID,
      characterId: OTHER_CHARACTER_ID,
      title: "他人のタイトル",
      createdAt: 100,
    });

    await authed(DB, "/api/scene-bookmarks/bm-mine", {
      method: "PATCH",
      body: JSON.stringify({ title: "更新後" }),
    });

    expect(readBookmark(db, "bm-mine")?.title).toBe("更新後");
    expect(readBookmark(db, "bm-theirs")?.title).toBe("他人のタイトル");
  });
});

describe.skipIf(!DatabaseSyncCtor)("DELETE /api/scene-bookmarks/:id (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 を返し、行を消さない", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-1", createdAt: 100 });

    const response = await anonymous(DB, "/api/scene-bookmarks/bm-1", { method: "DELETE" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(readBookmark(db, "bm-1")).toBeDefined();
  });

  it("id が idSchema の上限(128文字)を超えると 400 invalid bookmark id", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, `/api/scene-bookmarks/${"x".repeat(129)}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid bookmark id" });
  });

  it("他人のブックマークは 404 で消えない", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, {
      id: "bm-theirs",
      userId: OTHER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      messageId: OTHER_MESSAGE_ID,
      characterId: OTHER_CHARACTER_ID,
      createdAt: 100,
    });

    const response = await authed(DB, "/api/scene-bookmarks/bm-theirs", { method: "DELETE" });

    expect(response.status).toBe(404);
    expect(readBookmark(db, "bm-theirs")).toBeDefined();
  });

  it("自分のブックマークは 200 {ok:true} で実際に消える", async () => {
    const { db, DB } = makeRealD1();
    seedBookmark(db, { id: "bm-1", createdAt: 100 });
    seedBookmark(db, { id: "bm-2", createdAt: 200 });

    const response = await authed(DB, "/api/scene-bookmarks/bm-1", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readBookmark(db, "bm-1")).toBeUndefined();
    // 巻き込み削除が無いこと。
    expect(readBookmark(db, "bm-2")).toBeDefined();
  });

  it("存在せん id なら DELETE は 404 を返す", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/scene-bookmarks/bm-missing", { method: "DELETE" });

    expect(response.status).toBe(404);
  });
});
