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

// functions/api/routes/images.ts の HTTP 契約を検証する。
// 検証したいのは「他人の画像が読めんこと」「D1 が更新でけへんかった時に R2 が巻き戻ること」で、
// どちらも SQL 文字列を見るモックでは観測でけへんため実 SQLite に繋ぐ。
// 既存の image-r2-ownership.test.ts / image-persist.test.ts が触っとらん分岐を埋める。

const AUTH_TOKEN = "test-token";
// ensureUser は userId としてメールをそのまま返す。
const USER_EMAIL = "sukererion@gmail.com";
const USER_ID = USER_EMAIL;
const OTHER_USER_ID = "intruder@example.com";

// getUserEmail は Host が localhost の要求を無条件で運用者本人として解決する。
// 認証境界を測る時にこれを踏むと 401 を主張でけへんので、本番同等のオリジンへ固定する。
const ORIGIN = "https://adult-ai-chat.pages.dev";

const CHARACTER_ID = "char-mine";
const OTHER_CHARACTER_ID = "char-theirs";
const CONVERSATION_ID = "conv-mine";
const OTHER_CONVERSATION_ID = "conv-theirs";

// SELECT の選択列だけを深さ 0 のカンマで割って一意な別名を振る。
// 引用符と括弧の中は跨がん。
const aliasSelectColumns = (sql: string): string => {
  const scan = (from: number, stop: (index: number, depth: number) => boolean): number => {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < sql.length; i += 1) {
      const ch = sql[i];
      if (quote !== null) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (stop(i, depth)) return i;
    }
    return -1;
  };

  const selectEnd = sql.toLowerCase().indexOf("select") + "select".length;
  const fromIndex = scan(
    selectEnd,
    (i, depth) => depth === 0 && /^\sfrom\s/i.test(sql.slice(i, i + 6)),
  );
  if (fromIndex === -1) return sql;

  const parts: string[] = [];
  let previous = selectEnd;
  for (;;) {
    const comma = scan(previous, (i, depth) => depth === 0 && sql[i] === "," && i < fromIndex);
    if (comma === -1 || comma >= fromIndex) break;
    parts.push(sql.slice(previous, comma));
    previous = comma + 1;
  }
  parts.push(sql.slice(previous, fromIndex));

  const aliased = parts.map((part, index) => `${part.trim()} as "c${index}"`).join(", ");
  return `${sql.slice(0, selectEnd)} ${aliased}${sql.slice(fromIndex)}`;
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
      image_url TEXT, image_key TEXT, image_prompt TEXT, image_seed TEXT,
      image_lora_model TEXT, image_lora_weight REAL, image_lora_trigger_prompt TEXT,
      retry_count INTEGER, refusal_detected INTEGER,
      generation_model TEXT, raw_output TEXT, generation_phase TEXT, quality_meta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE chat_group (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      character_ids TEXT NOT NULL, scenario TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE group_message (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, speaker_character_id TEXT, content TEXT NOT NULL,
      image_url TEXT, image_key TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE character_sub_image (
      id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, r2_key TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0, gen_params TEXT, archived_at INTEGER
    );
  `);
  const insertUser = db.prepare("INSERT INTO user (id, email) VALUES (?, ?)");
  insertUser.run(USER_ID, USER_EMAIL);
  insertUser.run(OTHER_USER_ID, OTHER_USER_ID);
  const insertCharacter = db.prepare(
    "INSERT INTO character (id, user_id, name, avatar) VALUES (?, ?, ?, ?)",
  );
  insertCharacter.run(CHARACTER_ID, USER_ID, "みお", "https://cdn.example/mio.png");
  insertCharacter.run(OTHER_CHARACTER_ID, OTHER_USER_ID, "他人のキャラ", null);
  const insertConversation = db.prepare(
    "INSERT INTO conversation (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)",
  );
  insertConversation.run(CONVERSATION_ID, USER_ID, CHARACTER_ID, "本人の会話");
  insertConversation.run(OTHER_CONVERSATION_ID, OTHER_USER_ID, OTHER_CHARACTER_ID, "他人の会話");

  const wrap = (sql: string, args: unknown[]) => {
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const isSelect = /^\s*select/i.test(sql);
    const returnsRows = isSelect || /\breturning\b/i.test(sql);
    // RETURNING 付きの書き込みを二度実行せんよう、結果は一度だけ取って使い回す。
    let cached: Record<string, unknown>[] | undefined;
    let changes = 0;
    const rows = (): Record<string, unknown>[] => {
      if (cached === undefined) {
        if (returnsRows) {
          cached = db.prepare(sql).all(...bound) as Record<string, unknown>[];
        } else {
          const result = db.prepare(sql).run(...bound);
          changes = Number(result.changes);
          cached = [];
        }
      }
      return cached;
    };
    // drizzle の select は values()/raw() の「列順の配列」を前提にする。node:sqlite は
    // 行をオブジェクトで返すので、join で message.id と conversation.id のように
    // 同名列が並ぶと片方が潰れて列がずれる。選択列へ一意な別名を振って順序を保つ。
    let cachedOrdered: unknown[][] | undefined;
    const orderedRows = (): unknown[][] => {
      if (!isSelect) return rows().map((r) => Object.values(r));
      if (cachedOrdered === undefined) {
        cachedOrdered = (
          db.prepare(aliasSelectColumns(sql)).all(...bound) as Record<string, unknown>[]
        ).map((r) => Object.values(r));
      }
      return cachedOrdered;
    };
    return {
      all: async () => ({ results: rows(), success: true }),
      first: async () => rows()[0] ?? null,
      // getD1Changes は meta.changes だけを見る。UPDATE が 0 行だった事実を
      // ルート側へ渡すため、実 SQLite の changes をそのまま載せる。
      run: async () => {
        rows();
        return { success: true, meta: { changes }, results: [] };
      },
      raw: async <T = unknown[]>() => orderedRows() as T[],
      values: async <T = unknown[]>() => orderedRows() as T[],
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

const insertMessage = (
  db: DatabaseSync,
  row: {
    id: string;
    userId?: string;
    conversationId?: string;
    content?: string;
    imageUrl?: string | null;
    imageKey?: string | null;
    createdAt?: number;
  },
) => {
  db.prepare(
    `INSERT INTO message (id, user_id, conversation_id, character_id, role, content, image_url, image_key, created_at)
     VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.userId ?? USER_ID,
    row.conversationId ?? CONVERSATION_ID,
    CHARACTER_ID,
    row.content ?? "本文",
    row.imageUrl ?? null,
    row.imageKey ?? null,
    row.createdAt ?? 1_000,
  );
};

const readMessageImageKey = (db: DatabaseSync, id: string): string | null =>
  (
    db.prepare("SELECT image_key FROM message WHERE id = ?").get(id) as
      | { image_key: string | null }
      | undefined
  )?.image_key ?? null;

type R2ObjectStub = { body: string; httpMetadata?: { contentType?: string } } | null;

const makeBucket = (object: R2ObjectStub = null) => ({
  get: vi.fn().mockResolvedValue(object),
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
});

type TestEnv = {
  AUTH_TOKEN?: string;
  NOVITA_API_KEY?: string;
  RUNWARE_API_KEY?: string;
  DB: unknown;
  BUCKET: unknown;
};

const authedGet = (path: string, env: TestEnv) =>
  app.request(
    `${ORIGIN}${path}`,
    { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    env as never,
  );

const anonymousGet = (path: string, env: TestEnv) =>
  app.request(`${ORIGIN}${path}`, {}, env as never);

const postPersist = (body: unknown, env: TestEnv, authed = true) =>
  app.request(
    `${ORIGIN}/api/image/persist`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authed ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
    },
    env as never,
  );

// app.request が返す Response#json() は unknown なので、期待する形をここで宣言して読む。
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

type GalleryImage = {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  characterId: string;
  characterName: string;
  characterAvatar: string | null;
  imageUrl: string | null;
  imageKey: string | null;
  content: string;
  createdAt: number;
};

const OWNED_KEY = "images/11111111-1111-1111-1111-111111111111.png";
const SUB_KEY = "sub/char-mine/pose-a.png";

describe("GET /api/gallery/images", () => {
  it("未認証は 401 を返す（本番相当の Host で測る）", async () => {
    const { DB } = makeRealD1();
    const res = await anonymousGet("/api/gallery/images", { AUTH_TOKEN, DB, BUCKET: makeBucket() });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("本人の画像だけを createdAt 降順で返す（他人の行は混ざらん）", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m-old", imageUrl: "https://cdn/1.png", createdAt: 100 });
    insertMessage(db, {
      id: "m-new",
      imageUrl: "https://cdn/2.png",
      imageKey: OWNED_KEY,
      createdAt: 200,
    });
    // 他人の会話にある他人の画像。
    insertMessage(db, {
      id: "m-intruder",
      userId: OTHER_USER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      imageUrl: "https://cdn/secret.png",
      createdAt: 300,
    });

    const res = await authedGet("/api/gallery/images", { AUTH_TOKEN, DB, BUCKET: makeBucket() });
    expect(res.status).toBe(200);
    const body = await readJson<{ images: GalleryImage[] }>(res);
    expect(body.images.map((i) => i.messageId)).toEqual(["m-new", "m-old"]);
    expect(body.images[0]).toEqual({
      messageId: "m-new",
      conversationId: CONVERSATION_ID,
      conversationTitle: "本人の会話",
      characterId: CHARACTER_ID,
      characterName: "みお",
      characterAvatar: "https://cdn.example/mio.png",
      imageUrl: "https://cdn/2.png",
      imageKey: OWNED_KEY,
      content: "本文",
      createdAt: 200,
    });
  });

  it("他人のメッセージが本人の会話に紛れ込んどっても返さん", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, {
      id: "m-foreign-in-my-conv",
      userId: OTHER_USER_ID,
      conversationId: CONVERSATION_ID,
      imageUrl: "https://cdn/secret.png",
    });
    const res = await authedGet("/api/gallery/images", { AUTH_TOKEN, DB, BUCKET: makeBucket() });
    expect(await res.json()).toEqual({ images: [] });
  });

  it("本人のメッセージでも会話が他人のものなら返さん（会話タイトルが漏れる）", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, {
      id: "m-mine-in-their-conv",
      conversationId: OTHER_CONVERSATION_ID,
      imageUrl: "https://cdn/1.png",
    });
    const res = await authedGet("/api/gallery/images", { AUTH_TOKEN, DB, BUCKET: makeBucket() });
    expect(await res.json()).toEqual({ images: [] });
  });

  it("imageUrl が NULL のメッセージは除外する", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m-text-only" });
    insertMessage(db, { id: "m-with-image", imageUrl: "https://cdn/1.png" });
    const res = await authedGet("/api/gallery/images", { AUTH_TOKEN, DB, BUCKET: makeBucket() });
    const body = await readJson<{ images: GalleryImage[] }>(res);
    expect(body.images.map((i) => i.messageId)).toEqual(["m-with-image"]);
  });

  it("キャラが消えとる会話は characterName='AI' / characterAvatar=null に落とす", async () => {
    const { db, DB } = makeRealD1();
    db.prepare(
      "INSERT INTO conversation (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)",
    ).run("conv-orphan", USER_ID, "char-deleted", "キャラ消滅");
    insertMessage(db, {
      id: "m-orphan",
      conversationId: "conv-orphan",
      imageUrl: "https://cdn/1.png",
    });
    const res = await authedGet("/api/gallery/images", { AUTH_TOKEN, DB, BUCKET: makeBucket() });
    const body = await readJson<{ images: GalleryImage[] }>(res);
    expect(body.images).toHaveLength(1);
    expect(body.images[0].characterName).toBe("AI");
    expect(body.images[0].characterAvatar).toBeNull();
  });
});

describe("GET /api/image/providers", () => {
  it("未認証は 401 を返す", async () => {
    const { DB } = makeRealD1();
    const res = await anonymousGet("/api/image/providers", {
      AUTH_TOKEN,
      DB,
      BUCKET: makeBucket(),
      NOVITA_API_KEY: "novita",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("鍵の有無を boolean で返す（鍵の中身は漏らさん）", async () => {
    const { DB } = makeRealD1();
    const res = await authedGet("/api/image/providers", {
      AUTH_TOKEN,
      DB,
      BUCKET: makeBucket(),
      NOVITA_API_KEY: "novita-secret",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ novita: true, runware: false });
  });

  it("鍵が空文字なら false", async () => {
    const { DB } = makeRealD1();
    const res = await authedGet("/api/image/providers", {
      AUTH_TOKEN,
      DB,
      BUCKET: makeBucket(),
      NOVITA_API_KEY: "",
      RUNWARE_API_KEY: "runware",
    });
    expect(await res.json()).toEqual({ novita: false, runware: true });
  });
});

describe("POST /api/image/persist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (response: Response) => {
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("未認証は 401、上流 fetch も走らせん", async () => {
    const { DB } = makeRealD1();
    const fetchMock = stubFetch(new Response("x"));
    const res = await app.request(
      `${ORIGIN}/api/image/persist`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: "https://image.novita.ai/a.png", messageId: "m1" }),
      },
      { AUTH_TOKEN, DB, BUCKET: makeBucket() } as never,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("messageId 欠落は zValidator が 400 で弾く", async () => {
    const { DB } = makeRealD1();
    const fetchMock = stubFetch(new Response("x"));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/a.png" },
      {
        AUTH_TOKEN,
        DB,
        BUCKET: makeBucket(),
      },
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("URL でない imageUrl は zValidator が 400 で弾く", async () => {
    const { DB } = makeRealD1();
    const res = await postPersist(
      { imageUrl: "not-a-url", messageId: "m1" },
      {
        AUTH_TOKEN,
        DB,
        BUCKET: makeBucket(),
      },
    );
    expect(res.status).toBe(400);
  });

  it("許可外ホストは 400 disallowed image source（SSRF 防御・fetch せん）", async () => {
    const { DB } = makeRealD1();
    const bucket = makeBucket();
    const fetchMock = stubFetch(new Response("x"));
    const res = await postPersist(
      { imageUrl: "http://169.254.169.254/latest/meta-data/", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "disallowed image source" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("MOCK_API_BASE 無しなら localhost も許可せん", async () => {
    const { DB } = makeRealD1();
    const fetchMock = stubFetch(new Response("x"));
    const res = await postPersist(
      { imageUrl: "http://127.0.0.1:8788/mock.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: makeBucket() },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "disallowed image source" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("http/https 以外のスキームは 400 disallowed image source scheme", async () => {
    const { DB } = makeRealD1();
    const fetchMock = stubFetch(new Response("x"));
    const res = await postPersist(
      { imageUrl: "ftp://image.novita.ai/a.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: makeBucket() },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "disallowed image source scheme" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上流が 5xx なら 502 を返して R2 へ書かん", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    stubFetch(new Response("boom", { status: 500 }));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/a.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "failed to fetch image" });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("200 でも body が無ければ 502", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    stubFetch(new Response(null, { status: 200 }));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/a.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "failed to fetch image" });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("content-type ヘッダが無い応答は拡張子から推測せず 400", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    // Uint8Array の Response はヘッダを立てんので content-type は null になる。
    stubFetch(new Response(new Uint8Array([1, 2, 3])));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/a.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported content type" });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("画像でない content-type は 400 unsupported content type", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    stubFetch(new Response("<html>", { headers: { "content-type": "text/html" } }));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/a.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported content type" });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("application/octet-stream は URL 拡張子から型を決める", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    stubFetch(new Response("bytes", { headers: { "content-type": "application/octet-stream" } }));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/result.JPEG", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ imageKey: string }>(res);
    expect(body.imageKey).toMatch(/^images\/[\da-f-]{36}\.jpg$/);
    expect(bucket.put).toHaveBeenCalledWith(body.imageKey, expect.anything(), {
      httpMetadata: { contentType: "image/jpeg" },
    });
  });

  it("拡張子が判らん octet-stream は 400", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    stubFetch(new Response("bytes", { headers: { "content-type": "application/octet-stream" } }));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/result", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported content type" });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("10MB 超は 413 で、R2 へ 1 バイトも書かん", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    stubFetch(new Response(oversized, { headers: { "content-type": "image/png" } }));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/a.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "image too large" });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(readMessageImageKey(db, "m1")).toBeNull();
  });

  it("成功時は R2 へ put して message.image_key を実際に書き換える", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1" });
    const bucket = makeBucket();
    stubFetch(new Response("png-bytes", { headers: { "content-type": "image/png" } }));
    const res = await postPersist(
      { imageUrl: "https://im.runware.ai/a.png", messageId: "m1" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ imageKey: string }>(res);
    expect(body.imageKey).toMatch(/^images\/[\da-f-]{36}\.png$/);
    expect(readMessageImageKey(db, "m1")).toBe(body.imageKey);
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it("他人の messageId なら 0 行更新 → 404 + R2 の巻き戻し、他人の行は無傷", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, {
      id: "m-theirs",
      userId: OTHER_USER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      imageKey: "images/22222222-2222-2222-2222-222222222222.png",
    });
    const bucket = makeBucket();
    stubFetch(new Response("png-bytes", { headers: { "content-type": "image/png" } }));
    const res = await postPersist(
      { imageUrl: "https://image.novita.ai/a.png", messageId: "m-theirs" },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "message not found or already updated" });
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.delete).toHaveBeenCalledTimes(1);
    expect(bucket.delete).toHaveBeenCalledWith(bucket.put.mock.calls[0][0]);
    expect(readMessageImageKey(db, "m-theirs")).toBe(
      "images/22222222-2222-2222-2222-222222222222.png",
    );
  });
});

describe("GET /api/image/r2/:key", () => {
  it("未認証は 401 で、R2 も引かん", async () => {
    const { DB } = makeRealD1();
    const bucket = makeBucket({ body: "bytes" });
    const res = await anonymousGet(`/api/image/r2/${OWNED_KEY}`, {
      AUTH_TOKEN,
      DB,
      BUCKET: bucket,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it.each([
    ["拡張子が許可外", "images/11111111-1111-1111-1111-111111111111.gif"],
    ["prefix が許可外", "avatars/11111111-1111-1111-1111-111111111111.png"],
    ["16進以外の文字を含む", "images/ZZZZZZZZ.png"],
    ["sub/ が 2 階層に満たん", "sub/pose-a.png"],
  ])("%s キーは 400 で、所有判定にも R2 にも到達せん", async (_label, key) => {
    const { DB } = makeRealD1();
    const bucket = makeBucket({ body: "bytes" });
    const res = await authedGet(`/api/image/r2/${key}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid key format" });
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("所有者でなければ R2 を引く前に 404（403 でないのは存在を隠すため）", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, {
      id: "m-theirs",
      userId: OTHER_USER_ID,
      conversationId: OTHER_CONVERSATION_ID,
      imageKey: OWNED_KEY,
    });
    const bucket = makeBucket({ body: "bytes" });
    const res = await authedGet(`/api/image/r2/${OWNED_KEY}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    // 403 だと他人のキーが実在することが漏れる。ボディも 404 と同一に保つ。
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("group_message 経由の所有でも 200 になる", async () => {
    const { db, DB } = makeRealD1();
    db.prepare(
      "INSERT INTO chat_group (id, user_id, name, character_ids, created_at) VALUES (?, ?, ?, ?, 0)",
    ).run("grp-1", USER_ID, "グループ", "[]");
    db.prepare(
      "INSERT INTO group_message (id, group_id, user_id, role, content, image_key, created_at) VALUES (?, ?, ?, 'assistant', ?, ?, 0)",
    ).run("gm-1", "grp-1", USER_ID, "本文", OWNED_KEY);
    const bucket = makeBucket({ body: "bytes", httpMetadata: { contentType: "image/png" } });
    const res = await authedGet(`/api/image/r2/${OWNED_KEY}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(200);
    expect(bucket.get).toHaveBeenCalledWith(OWNED_KEY);
  });

  it("sub/ の多階層キーがワイルドカードで丸ごと取れる（所有キャラ経由で 200）", async () => {
    const { db, DB } = makeRealD1();
    db.prepare("INSERT INTO character_sub_image (character_id, r2_key) VALUES (?, ?)").run(
      CHARACTER_ID,
      SUB_KEY,
    );
    const bucket = makeBucket({ body: "bytes", httpMetadata: { contentType: "image/png" } });
    const res = await authedGet(`/api/image/r2/${SUB_KEY}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(200);
    // :key{.+} がスラッシュを跨いで捕まえとらんかったら、ここで先頭セグメントしか届かん。
    expect(bucket.get).toHaveBeenCalledWith(SUB_KEY);
  });

  it("sub/ キーが他人のキャラに紐づくなら 404", async () => {
    const { db, DB } = makeRealD1();
    db.prepare("INSERT INTO character_sub_image (character_id, r2_key) VALUES (?, ?)").run(
      OTHER_CHARACTER_ID,
      SUB_KEY,
    );
    const bucket = makeBucket({ body: "bytes" });
    const res = await authedGet(`/api/image/r2/${SUB_KEY}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("sub/ キーの行が無ければ 404", async () => {
    const { DB } = makeRealD1();
    const bucket = makeBucket({ body: "bytes" });
    const res = await authedGet(`/api/image/r2/${SUB_KEY}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(404);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("所有しとっても R2 に実体が無ければ 404", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1", imageKey: OWNED_KEY });
    const bucket = makeBucket(null);
    const res = await authedGet(`/api/image/r2/${OWNED_KEY}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });

  it("contentType が無い R2 オブジェクトは image/png 扱いで、キャッシュは private, no-store", async () => {
    const { db, DB } = makeRealD1();
    insertMessage(db, { id: "m1", imageKey: OWNED_KEY });
    const bucket = makeBucket({ body: "bytes" });
    const res = await authedGet(`/api/image/r2/${OWNED_KEY}`, { AUTH_TOKEN, DB, BUCKET: bucket });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // 端末キャッシュへ他人の目に触れる形で残さんための約束。
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toBe("bytes");
  });
});
