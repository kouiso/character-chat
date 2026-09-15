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

// conversations.ts の判定はほぼ全部「どの行が残るか / 消えるか」なので、SQL 文字列を
// 覗くモックやのうて実 SQLite に繋ぐ。外部キーは張らん。cascade で消えると
// ルート自身が消しとるのか SQLite が消したのかを区別でけへんなる。
const AUTH_TOKEN = "test-token";
const USER_EMAIL = "sukererion@gmail.com";
// ensureUser は userId としてメールをそのまま返す。
const OWNER_ID = USER_EMAIL;
const OTHER_ID = "intruder@example.com";
const CHARACTER_ID = "char-owner";
const OTHER_CHARACTER_ID = "char-other";

// getUserEmail は Host が localhost の要求を運用者本人として通す。相対パスで
// app.request すると Host が localhost 扱いになり得るので、認証境界を見るテストが
// 「本人と解決されてしもうて 200」やのうて確実に未認証を再現するよう、
// 全要求で本番と同じ絶対 URL を使う。
const ORIGIN = "https://adult-ai-chat.pages.dev";

type Seed = {
  id: string;
  userId?: string;
  characterId?: string;
  title?: string;
  parentConversationId?: string | null;
  branchedFromMessageId?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

type MessageSeed = {
  id: string;
  userId?: string;
  conversationId: string;
  characterId?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
  createdAt: number;
  imageUrl?: string | null;
  imageKey?: string | null;
  imagePrompt?: string | null;
  imageSeed?: string | null;
  imageLoraModel?: string | null;
  imageLoraWeight?: number | null;
  imageLoraTriggerPrompt?: string | null;
  generationModel?: string | null;
  generationPhase?: string | null;
};

// SELECT の選択列だけを深さ 0 のカンマで割って一意な別名を振る。
// 引用符と括弧の中は跨がん。node:sqlite が重複カラム名をマージするのを防ぎ、
// drizzle の values()/raw() が列順の配列を正しく読めるようにする。
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
    CREATE TABLE message_feedback (
      message_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      character_id TEXT NOT NULL, rating TEXT NOT NULL, reason TEXT,
      message_content TEXT NOT NULL, previous_user_content TEXT, variant_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE memory_note (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      content TEXT NOT NULL, source_message_id TEXT, created_at INTEGER NOT NULL,
      edited_at INTEGER, last_used_at INTEGER, usage_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversation_share (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER
    );
    CREATE TABLE scene_bookmark (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL, title TEXT NOT NULL, snippet TEXT NOT NULL,
      character_name TEXT NOT NULL, character_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE quality_report_dedup (
      conversation_id TEXT PRIMARY KEY, last_reported_at INTEGER NOT NULL
    );
    CREATE TABLE conversation_scene_state (
      conversation_id TEXT PRIMARY KEY, location_id TEXT, current_outfit_id TEXT,
      background_tag TEXT, undress_level TEXT NOT NULL DEFAULT 'clothed',
      mate_present INTEGER NOT NULL DEFAULT 0, last_pose TEXT, last_camera TEXT,
      mood TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE conversation_scene_body_fluid (
      conversation_id TEXT NOT NULL, tag TEXT NOT NULL
    );
  `);

  const insertUser = db.prepare("INSERT INTO user (id, email) VALUES (?, ?)");
  insertUser.run(OWNER_ID, USER_EMAIL);
  insertUser.run(OTHER_ID, OTHER_ID);

  const wrap = (sql: string, args: unknown[]) => {
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const isSelect = /^\s*select/i.test(sql);
    const returnsRows = isSelect || /\breturning\b/i.test(sql);
    // 同一 SQL を二度実行せんよう、結果は一度だけ取って使い回す。
    let cached: Record<string, unknown>[] | undefined;
    let ordered: unknown[][] | undefined;
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
    // drizzle は SELECT / RETURNING を raw() / values() で列順配列として読む。
    // 自己 JOIN 等で同名カラムが重複する場合、オブジェクトでは後勝ちになって列がズレる。
    // SELECT 節の選択列に c0, c1, ... という別名を振り、Object.values() で正しい順序を保つ。
    const orderedRows = (): unknown[][] => {
      if (ordered === undefined) {
        ordered = (
          isSelect
            ? (db.prepare(aliasSelectColumns(sql)).all(...bound) as Record<string, unknown>[])
            : rows()
        ).map((row) => Object.values(row));
      }
      return ordered;
    };
    return {
      all: async () => ({ results: rows(), success: true }),
      first: async () => rows()[0] ?? null,
      // getD1Changes は meta.changes を見て更新有無を判定する。
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

type Env = ReturnType<typeof makeRealD1>["DB"];

const seedCharacter = (
  db: DatabaseSync,
  options: {
    id?: string;
    userId?: string;
    name?: string;
    greeting?: string;
    systemPrompt?: string;
    avatar?: string | null;
    displayOrder?: number;
    createdAt?: number;
  } = {},
) => {
  db.prepare(
    `INSERT INTO character (id, user_id, name, greeting, system_prompt, avatar, display_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    options.id ?? CHARACTER_ID,
    options.userId ?? OWNER_ID,
    options.name ?? "本人キャラ",
    options.greeting ?? "",
    options.systemPrompt ?? "",
    options.avatar ?? null,
    options.displayOrder ?? 0,
    options.createdAt ?? 0,
  );
};

const seedConversation = (db: DatabaseSync, seed: Seed) => {
  db.prepare(
    `INSERT INTO conversation
       (id, user_id, character_id, title, parent_conversation_id, branched_from_message_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.userId ?? OWNER_ID,
    seed.characterId ?? CHARACTER_ID,
    seed.title ?? `title-${seed.id}`,
    seed.parentConversationId ?? null,
    seed.branchedFromMessageId ?? null,
    seed.createdAt ?? 0,
    seed.updatedAt ?? 0,
  );
};

const seedMessage = (db: DatabaseSync, seed: MessageSeed) => {
  db.prepare(
    `INSERT INTO message
       (id, user_id, conversation_id, character_id, role, content, created_at,
        image_url, image_key, image_prompt, image_seed,
        image_lora_model, image_lora_weight, image_lora_trigger_prompt,
        generation_model, generation_phase)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.userId ?? OWNER_ID,
    seed.conversationId,
    seed.characterId ?? CHARACTER_ID,
    seed.role ?? "assistant",
    seed.content ?? `content-${seed.id}`,
    seed.createdAt,
    seed.imageUrl ?? null,
    seed.imageKey ?? null,
    seed.imagePrompt ?? null,
    seed.imageSeed ?? null,
    seed.imageLoraModel ?? null,
    seed.imageLoraWeight ?? null,
    seed.imageLoraTriggerPrompt ?? null,
    seed.generationModel ?? null,
    seed.generationPhase ?? null,
  );
};

const seedFeedback = (
  db: DatabaseSync,
  options: { messageId: string; userId?: string; conversationId: string; rating?: string },
) => {
  db.prepare(
    `INSERT INTO message_feedback
       (message_id, user_id, conversation_id, character_id, rating, reason,
        message_content, previous_user_content, variant_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, '', NULL, NULL, 0, 0)`,
  ).run(
    options.messageId,
    options.userId ?? OWNER_ID,
    options.conversationId,
    CHARACTER_ID,
    options.rating ?? "good",
  );
};

const count = (db: DatabaseSync, sql: string, ...args: string[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;

const countMessages = (db: DatabaseSync, conversationId: string) =>
  count(db, "SELECT COUNT(*) AS n FROM message WHERE conversation_id = ?", conversationId);

const readConversation = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT * FROM conversation WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;

const readMessage = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT * FROM message WHERE id = ?").get(id) as Record<string, unknown> | undefined;

const readFeedback = (db: DatabaseSync, messageId: string) =>
  db.prepare("SELECT * FROM message_feedback WHERE message_id = ?").get(messageId) as
    | Record<string, unknown>
    | undefined;

const authed = (DB: Env, path: string, init: RequestInit = {}) =>
  app.request(
    `${ORIGIN}${path}`,
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

// Authorization を付けん。Host も本番ドメインなので getUserEmail は誰も解決できん。
const anonymous = (DB: Env, path: string, init: RequestInit = {}) =>
  app.request(`${ORIGIN}${path}`, init, { AUTH_TOKEN, DB });

// Response#json() の戻り値型が eslint(DOM の any) と tsc(Workers 型の unknown) で
// 食い違い、型アサーションを書くと片方だけが怒る。JSON.parse を挟んで戻り値型を決める。
type ConversationPayload = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  characterId: string;
  characterName: string;
  characterGreeting: string;
  characterSystemPrompt: string;
  characterAvatar: string | null;
  parentConversationId: string | null;
  branchedFromMessageId: string | null;
  parentTitle: string | null;
  lastAssistantMessage?: string;
  greetingMessageId?: string | null;
};

type MessagePayload = {
  id: string;
  role: string;
  content: string;
  imageUrl: string | null;
  imageKey: string | null;
  imagePrompt: string | null;
  imageSeed: string | null;
  imageLoraModel: string | null;
  imageLoraWeight: number | null;
  imageLoraTriggerPrompt: string | null;
  createdAt: number;
  generationModel: string | null;
  generationPhase: string | null;
  feedbackRating: string | null;
};

type SearchResultPayload = {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: string;
  snippet: string;
  createdAt: number;
  characterName: string;
  characterAvatar: string | null;
};

const readConversationList = async (
  response: Response,
): Promise<{ conversations: ConversationPayload[] }> => JSON.parse(await response.text());

const readCreated = async (response: Response): Promise<{ conversation: ConversationPayload }> =>
  JSON.parse(await response.text());

const readMessageList = async (response: Response): Promise<{ messages: MessagePayload[] }> =>
  JSON.parse(await response.text());

const readSearch = async (response: Response): Promise<{ results: SearchResultPayload[] }> =>
  JSON.parse(await response.text());

const TOO_LONG_ID = "x".repeat(129);

describe.skipIf(!DatabaseSyncCtor)("GET /api/conversations (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const { DB } = makeRealD1();

    const response = await anonymous(DB, "/api/conversations");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("他人の会話は一覧に混ざらず、返るのは本人の1件だけ", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { avatar: "avatar.png", greeting: "やあ" });
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, { id: "conv-mine", title: "自分の会話", updatedAt: 100 });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
      title: "他人の会話",
      // 本人の会話より新しい。所有権で絞れてへんかったら先頭に出る。
      updatedAt: 999,
    });

    const response = await authed(DB, "/api/conversations");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conversations: [
        {
          id: "conv-mine",
          title: "自分の会話",
          createdAt: 0,
          updatedAt: 100,
          characterId: CHARACTER_ID,
          characterName: "本人キャラ",
          characterGreeting: "やあ",
          // systemPrompt が空文字なので関係性の再構築へ入らず、そのまま空で返る。
          characterSystemPrompt: "",
          characterAvatar: "avatar.png",
          parentConversationId: null,
          branchedFromMessageId: null,
          parentTitle: null,
        },
      ],
    });
  });

  it("updatedAt の降順で並ぶ", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-old", updatedAt: 100 });
    seedConversation(db, { id: "conv-new", updatedAt: 300 });
    seedConversation(db, { id: "conv-mid", updatedAt: 200 });

    const body = await readConversationList(await authed(DB, "/api/conversations"));

    expect(body.conversations.map((c) => c.id)).toEqual(["conv-new", "conv-mid", "conv-old"]);
  });

  it("lastAssistantMessage は最新 assistant の XML タグを除いた先頭50字になる", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, { id: "m-old", conversationId: "conv-1", content: "古い返事", createdAt: 100 });
    seedMessage(db, {
      id: "m-new",
      conversationId: "conv-1",
      content: `<response>${"あ".repeat(60)}</response>`,
      createdAt: 200,
    });

    const body = await readConversationList(await authed(DB, "/api/conversations"));

    expect(body.conversations[0].lastAssistantMessage).toBe("あ".repeat(50));
  });

  it("assistant メッセージが無い会話には lastAssistantMessage キー自体が付かん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, { id: "m-user", conversationId: "conv-1", role: "user", createdAt: 100 });

    const body = await readConversationList(await authed(DB, "/api/conversations"));

    expect(body.conversations[0]).not.toHaveProperty("lastAssistantMessage");
  });

  it("分岐会話には親会話の title が parentTitle として入る", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-parent", title: "親の会話", updatedAt: 100 });
    seedConversation(db, {
      id: "conv-branch",
      title: "分岐",
      parentConversationId: "conv-parent",
      branchedFromMessageId: "msg-pivot",
      updatedAt: 200,
    });

    const body = await readConversationList(await authed(DB, "/api/conversations"));

    expect(body.conversations[0]).toMatchObject({
      id: "conv-branch",
      parentConversationId: "conv-parent",
      branchedFromMessageId: "msg-pivot",
      parentTitle: "親の会話",
    });
    expect(body.conversations[1].parentTitle).toBeNull();
  });

  it("キャラ行が消えとる会話は characterName が 'AI' に落ちる", async () => {
    const { db, DB } = makeRealD1();
    // character 行を作らんまま会話だけ残す（キャラ削除後の孤児会話）。
    seedConversation(db, { id: "conv-orphan", characterId: "char-gone" });

    const body = await readConversationList(await authed(DB, "/api/conversations"));

    expect(body.conversations[0]).toMatchObject({
      characterName: "AI",
      characterGreeting: "",
      characterSystemPrompt: "",
      characterAvatar: null,
    });
  });

  it("systemPrompt を持つキャラでは関係性セクションが再構築されて返る", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { systemPrompt: "MARKER_PERSONALITY_TEXT" });
    seedConversation(db, { id: "conv-1" });

    const body = await readConversationList(await authed(DB, "/api/conversations"));

    expect(body.conversations[0].characterSystemPrompt).toContain("MARKER_PERSONALITY_TEXT");
    // メッセージ0件なので呼び方段階は初期段階。
    expect(body.conversations[0].characterSystemPrompt).toContain("呼び方は苗字+さん");
  });
});

describe.skipIf(!DatabaseSyncCtor)("POST /api/conversations (実SQLite)", () => {
  const create = (DB: Env, body: unknown) =>
    authed(DB, "/api/conversations", { method: "POST", body: JSON.stringify(body) });

  it("認証ヘッダが無ければ 401 で、会話を作らん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);

    const response = await anonymous(DB, "/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: CHARACTER_ID }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation")).toBe(0);
  });

  it("他人のキャラ ID を指定すると 404 character not found で、会話を作らん", async () => {
    const { db, DB } = makeRealD1();
    // 本人にもキャラがある状態で他人の ID を渡す。fallback へ逃げたらここが 201 になる。
    seedCharacter(db);
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });

    const response = await create(DB, { characterId: OTHER_CHARACTER_ID });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation")).toBe(0);
  });

  it("キャラを1つも持たんまま characterId 省略で叩くと 400 character required", async () => {
    const { db, DB } = makeRealD1();
    // 他人のキャラだけ存在する状態。fallback が所有権で絞れてへんかったら通ってまう。
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });

    const response = await create(DB, {});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "character required",
      message: "Please create your first character before starting a conversation.",
    });
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation")).toBe(0);
  });

  it("characterId 省略時は displayOrder 昇順の先頭キャラへ落ちる", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { id: "char-second", displayOrder: 5, name: "後ろ" });
    seedCharacter(db, { id: "char-first", displayOrder: 1, name: "先頭" });

    const response = await create(DB, {});

    expect(response.status).toBe(201);
    const body = await readCreated(response);
    expect(body.conversation.characterId).toBe("char-first");
    expect(body.conversation.characterName).toBe("先頭");
  });

  it("title が201文字なら 400 で弾かれ、会話を作らん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);

    const response = await create(DB, { characterId: CHARACTER_ID, title: "あ".repeat(201) });

    expect(response.status).toBe(400);
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation")).toBe(0);
  });

  it("同じキャラの記憶ノートが新しい会話の systemPrompt へ載る", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { systemPrompt: "MARKER_PROMPT" });
    const insertNote = db.prepare(
      "INSERT INTO memory_note (id, user_id, character_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insertNote.run("note-mine", OWNER_ID, CHARACTER_ID, "MEMORY_MINE", 100);
    // 別キャラ・他人のノートは混ざらんこと。
    insertNote.run("note-other-char", OWNER_ID, "char-else", "MEMORY_OTHER_CHAR", 200);
    insertNote.run("note-theirs", OTHER_ID, CHARACTER_ID, "MEMORY_THEIRS", 300);

    const { conversation } = await readCreated(await create(DB, { characterId: CHARACTER_ID }));

    expect(conversation.characterSystemPrompt).toContain("MEMORY_MINE");
    expect(conversation.characterSystemPrompt).not.toContain("MEMORY_OTHER_CHAR");
    expect(conversation.characterSystemPrompt).not.toContain("MEMORY_THEIRS");
  });

  it("characterId が空文字なら 400 で弾かれる", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);

    const response = await create(DB, { characterId: "" });

    expect(response.status).toBe(400);
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation")).toBe(0);
  });

  it("greeting が空なら greetingMessageId は null で、メッセージ行も作らん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { greeting: "   " });

    const response = await create(DB, { characterId: CHARACTER_ID });

    expect(response.status).toBe(201);
    const body = await readCreated(response);
    expect(body.conversation.greetingMessageId).toBeNull();
    expect(count(db, "SELECT COUNT(*) AS n FROM message")).toBe(0);
  });

  it("正常系は 201 で会話と greeting を保存し、greetingMessageId を返す", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { greeting: "おかえり", avatar: "a.png", systemPrompt: "MARKER_PROMPT" });

    const response = await create(DB, { characterId: CHARACTER_ID, title: "夜の話" });

    expect(response.status).toBe(201);
    const { conversation } = await readCreated(response);
    expect(conversation).toMatchObject({
      title: "夜の話",
      characterId: CHARACTER_ID,
      characterName: "本人キャラ",
      characterGreeting: "おかえり",
      characterAvatar: "a.png",
      parentConversationId: null,
      branchedFromMessageId: null,
      parentTitle: null,
    });
    expect(conversation.characterSystemPrompt).toContain("MARKER_PROMPT");
    expect(conversation.greetingMessageId).toBe(`greeting-${conversation.id}`);

    const stored = readConversation(db, conversation.id);
    expect(stored?.user_id).toBe(OWNER_ID);
    expect(stored?.title).toBe("夜の話");
    const greeting = readMessage(db, `greeting-${conversation.id}`);
    expect(greeting?.content).toBe("おかえり");
    expect(greeting?.role).toBe("assistant");
    expect(greeting?.user_id).toBe(OWNER_ID);
  });

  it("title 省略時のタイトルは「新しい会話」", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);

    const { conversation } = await readCreated(await create(DB, { characterId: CHARACTER_ID }));

    expect(conversation.title).toBe("新しい会話");
    expect(readConversation(db, conversation.id)?.title).toBe("新しい会話");
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/conversations/:id/branches (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const { DB } = makeRealD1();

    const response = await anonymous(DB, "/api/conversations/conv-1/branches");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("id が128文字を超えると 400 invalid conversation id", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, `/api/conversations/${TOO_LONG_ID}/branches`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid conversation id" });
  });

  it("他人の会話 ID なら 404 conversation not found", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
    });

    const response = await authed(DB, "/api/conversations/conv-theirs/branches");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation not found" });
  });

  it("分岐が無ければ空配列を返す", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });

    const response = await authed(DB, "/api/conversations/conv-1/branches");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversations: [] });
  });

  it("自分の分岐だけを updatedAt 降順で返し、他人の分岐や別会話の分岐は混ざらん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { avatar: "a.png", greeting: "やあ" });
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, { id: "conv-parent", title: "親" });
    seedConversation(db, { id: "conv-unrelated", title: "別の親" });
    seedConversation(db, {
      id: "branch-old",
      title: "分岐A",
      parentConversationId: "conv-parent",
      branchedFromMessageId: "msg-1",
      updatedAt: 100,
    });
    seedConversation(db, {
      id: "branch-new",
      title: "分岐B",
      parentConversationId: "conv-parent",
      branchedFromMessageId: "msg-2",
      updatedAt: 200,
    });
    seedConversation(db, {
      id: "branch-elsewhere",
      title: "別会話の分岐",
      parentConversationId: "conv-unrelated",
      updatedAt: 300,
    });
    // 他人が同じ親 ID を指す分岐を持っとる場合。userId で絞れてへんかったら漏れる。
    seedConversation(db, {
      id: "branch-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
      title: "他人の分岐",
      parentConversationId: "conv-parent",
      updatedAt: 999,
    });

    const response = await authed(DB, "/api/conversations/conv-parent/branches");

    expect(response.status).toBe(200);
    const body = await readConversationList(response);
    expect(body.conversations.map((c) => c.id)).toEqual(["branch-new", "branch-old"]);
    expect(body.conversations[0]).toEqual({
      id: "branch-new",
      title: "分岐B",
      createdAt: 0,
      updatedAt: 200,
      characterId: CHARACTER_ID,
      characterName: "本人キャラ",
      characterGreeting: "やあ",
      characterSystemPrompt: "",
      characterAvatar: "a.png",
      parentConversationId: "conv-parent",
      branchedFromMessageId: "msg-2",
      parentTitle: "親",
    });
    // 一覧と違い branches は lastAssistantMessage を返さん。
    expect(body.conversations[0]).not.toHaveProperty("lastAssistantMessage");
  });
});

describe.skipIf(!DatabaseSyncCtor)("DELETE /api/conversations（一括） (実SQLite)", () => {
  const seedBothUsers = (db: DatabaseSync) => {
    seedCharacter(db);
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, { id: "conv-mine" });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
    });
    seedMessage(db, { id: "msg-mine", conversationId: "conv-mine", createdAt: 100 });
    seedMessage(db, {
      id: "msg-theirs",
      userId: OTHER_ID,
      conversationId: "conv-theirs",
      characterId: OTHER_CHARACTER_ID,
      createdAt: 100,
    });
    seedFeedback(db, { messageId: "msg-mine", conversationId: "conv-mine" });
    seedFeedback(db, { messageId: "msg-theirs", userId: OTHER_ID, conversationId: "conv-theirs" });
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, '{}', 0)",
    ).run("share-mine", "conv-mine", OWNER_ID);
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, '{}', 0)",
    ).run("share-theirs", "conv-theirs", OTHER_ID);
    db.prepare(
      `INSERT INTO scene_bookmark (id, user_id, conversation_id, message_id, title, snippet, character_name, character_id, created_at)
       VALUES (?, ?, ?, ?, 't', 's', 'c', NULL, 0)`,
    ).run("bm-mine", OWNER_ID, "conv-mine", "msg-mine");
    db.prepare(
      `INSERT INTO scene_bookmark (id, user_id, conversation_id, message_id, title, snippet, character_name, character_id, created_at)
       VALUES (?, ?, ?, ?, 't', 's', 'c', NULL, 0)`,
    ).run("bm-theirs", OTHER_ID, "conv-theirs", "msg-theirs");
    const dedup = db.prepare(
      "INSERT INTO quality_report_dedup (conversation_id, last_reported_at) VALUES (?, 0)",
    );
    dedup.run("conv-mine");
    dedup.run("conv-theirs");
    const sceneState = db.prepare(
      "INSERT INTO conversation_scene_state (conversation_id, updated_at) VALUES (?, 0)",
    );
    sceneState.run("conv-mine");
    sceneState.run("conv-theirs");
    const fluid = db.prepare(
      "INSERT INTO conversation_scene_body_fluid (conversation_id, tag) VALUES (?, 'x')",
    );
    fluid.run("conv-mine");
    fluid.run("conv-theirs");
  };

  it("認証ヘッダが無ければ 401 で、1行も消えん", async () => {
    const { db, DB } = makeRealD1();
    seedBothUsers(db);

    const response = await anonymous(DB, "/api/conversations", { method: "DELETE" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation")).toBe(2);
    expect(count(db, "SELECT COUNT(*) AS n FROM message")).toBe(2);
  });

  it("要求者の行だけを全テーブルから消し、他人の行は1件も落とさん", async () => {
    const { db, DB } = makeRealD1();
    seedBothUsers(db);

    const response = await authed(DB, "/api/conversations", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const remaining = (table: string) =>
      db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];

    expect(remaining("conversation").map((r) => r.id)).toEqual(["conv-theirs"]);
    expect(remaining("message").map((r) => r.id)).toEqual(["msg-theirs"]);
    expect(remaining("message_feedback").map((r) => r.message_id)).toEqual(["msg-theirs"]);
    expect(remaining("conversation_share").map((r) => r.id)).toEqual(["share-theirs"]);
    expect(remaining("scene_bookmark").map((r) => r.id)).toEqual(["bm-theirs"]);
    expect(remaining("quality_report_dedup").map((r) => r.conversation_id)).toEqual([
      "conv-theirs",
    ]);
    expect(remaining("conversation_scene_state").map((r) => r.conversation_id)).toEqual([
      "conv-theirs",
    ]);
    expect(remaining("conversation_scene_body_fluid").map((r) => r.conversation_id)).toEqual([
      "conv-theirs",
    ]);
    // キャラ・ユーザーは一括削除の対象外。
    expect(count(db, "SELECT COUNT(*) AS n FROM character")).toBe(2);
  });
});

describe.skipIf(!DatabaseSyncCtor)("DELETE /api/conversations/:id (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 で、会話は残る", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });

    const response = await anonymous(DB, "/api/conversations/conv-1", { method: "DELETE" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(readConversation(db, "conv-1")).toBeDefined();
  });

  it("id が128文字を超えると 400 invalid conversation id", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, `/api/conversations/${TOO_LONG_ID}`, { method: "DELETE" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid conversation id" });
  });

  it("他人の会話は 404 で、行もメッセージも残る", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
    });
    seedMessage(db, {
      id: "msg-theirs",
      userId: OTHER_ID,
      conversationId: "conv-theirs",
      characterId: OTHER_CHARACTER_ID,
      createdAt: 100,
    });

    const response = await authed(DB, "/api/conversations/conv-theirs", { method: "DELETE" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation not found" });
    expect(readConversation(db, "conv-theirs")).toBeDefined();
    expect(readMessage(db, "msg-theirs")).toBeDefined();
  });

  it("存在せん会話は 404 conversation not found", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/conversations/conv-missing", { method: "DELETE" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation not found" });
  });

  it("自分の会話は子テーブルごと消え、別の会話は巻き込まれん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-target" });
    seedConversation(db, { id: "conv-keep" });
    seedMessage(db, { id: "msg-target", conversationId: "conv-target", createdAt: 100 });
    seedMessage(db, { id: "msg-keep", conversationId: "conv-keep", createdAt: 100 });
    seedFeedback(db, { messageId: "msg-target", conversationId: "conv-target" });
    seedFeedback(db, { messageId: "msg-keep", conversationId: "conv-keep" });
    db.prepare(
      "INSERT INTO conversation_share (id, conversation_id, user_id, payload, created_at) VALUES (?, ?, ?, '{}', 0)",
    ).run("share-target", "conv-target", OWNER_ID);
    db.prepare(
      `INSERT INTO scene_bookmark (id, user_id, conversation_id, message_id, title, snippet, character_name, character_id, created_at)
       VALUES (?, ?, ?, ?, 't', 's', 'c', NULL, 0)`,
    ).run("bm-target", OWNER_ID, "conv-target", "msg-target");
    db.prepare(
      "INSERT INTO conversation_scene_state (conversation_id, updated_at) VALUES (?, 0)",
    ).run("conv-target");

    const response = await authed(DB, "/api/conversations/conv-target", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readConversation(db, "conv-target")).toBeUndefined();
    expect(readMessage(db, "msg-target")).toBeUndefined();
    expect(readFeedback(db, "msg-target")).toBeUndefined();
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation_share")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS n FROM scene_bookmark")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS n FROM conversation_scene_state")).toBe(0);

    expect(readConversation(db, "conv-keep")).toBeDefined();
    expect(readMessage(db, "msg-keep")).toBeDefined();
    expect(readFeedback(db, "msg-keep")).toBeDefined();
  });

  it("子会話が親を参照していても、親を削除できる。子はリンクを失って残る", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-parent" });
    seedConversation(db, {
      id: "conv-child",
      parentConversationId: "conv-parent",
      branchedFromMessageId: "msg-pivot",
    });
    seedMessage(db, { id: "msg-pivot", conversationId: "conv-parent", createdAt: 100 });

    const response = await authed(DB, "/api/conversations/conv-parent", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readConversation(db, "conv-parent")).toBeUndefined();
    const child = readConversation(db, "conv-child");
    expect(child).toBeDefined();
    expect(child?.parent_conversation_id).toBeNull();
    expect(child?.branched_from_message_id).toBeNull();
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/conversations/search/messages (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const { DB } = makeRealD1();

    const response = await anonymous(DB, "/api/conversations/search/messages?q=kiss");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("q が無いと 400", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/conversations/search/messages");

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("q が空白だけなら trim 後に長さ0で 400", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, "/api/conversations/search/messages?q=%20%20");

    expect(response.status).toBe(400);
  });

  it("limit が上限(50)を超えると 400、0でも 400", async () => {
    const { DB } = makeRealD1();

    expect((await authed(DB, "/api/conversations/search/messages?q=a&limit=51")).status).toBe(400);
    expect((await authed(DB, "/api/conversations/search/messages?q=a&limit=0")).status).toBe(400);
  });

  it("大文字小文字を無視して当たり、system ロールと他人のメッセージは返さん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { avatar: "a.png" });
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, { id: "conv-mine", title: "自分の会話" });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
      title: "他人の会話",
    });
    seedMessage(db, {
      id: "hit",
      conversationId: "conv-mine",
      content: "KISSした",
      createdAt: 100,
    });
    seedMessage(db, {
      id: "sys",
      conversationId: "conv-mine",
      role: "system",
      content: "kiss を含むシステム",
      createdAt: 200,
    });
    seedMessage(db, {
      id: "theirs",
      userId: OTHER_ID,
      conversationId: "conv-theirs",
      characterId: OTHER_CHARACTER_ID,
      content: "kiss した",
      createdAt: 300,
    });

    const response = await authed(DB, "/api/conversations/search/messages?q=kiss");

    expect(response.status).toBe(200);
    // 検索パスがワイルドカードの :conversationId に食われてへんことも同時に確かめとる。
    expect(await response.json()).toEqual({
      results: [
        {
          messageId: "hit",
          conversationId: "conv-mine",
          conversationTitle: "自分の会話",
          role: "assistant",
          snippet: "KISSした",
          createdAt: 100,
          characterName: "本人キャラ",
          characterAvatar: "a.png",
        },
      ],
    });
  });

  it("createdAt 降順で返り、limit で件数が切られる", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, { id: "m1", conversationId: "conv-1", content: "kiss 1", createdAt: 100 });
    seedMessage(db, { id: "m2", conversationId: "conv-1", content: "kiss 2", createdAt: 200 });
    seedMessage(db, { id: "m3", conversationId: "conv-1", content: "kiss 3", createdAt: 300 });

    const all = await readSearch(await authed(DB, "/api/conversations/search/messages?q=kiss"));
    expect(all.results.map((r) => r.messageId)).toEqual(["m3", "m2", "m1"]);

    const limited = await readSearch(
      await authed(DB, "/api/conversations/search/messages?q=kiss&limit=2"),
    );
    expect(limited.results.map((r) => r.messageId)).toEqual(["m3", "m2"]);
  });

  it("q の % はワイルドカードにならずリテラルとして照合される", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "literal",
      conversationId: "conv-1",
      content: "100%達成",
      createdAt: 100,
    });
    seedMessage(db, {
      id: "wildcard",
      conversationId: "conv-1",
      content: "100倍達成",
      createdAt: 200,
    });

    const body = await readSearch(
      await authed(DB, `/api/conversations/search/messages?q=${encodeURIComponent("100%達成")}`),
    );

    expect(body.results.map((r) => r.messageId)).toEqual(["literal"]);
  });

  it("ヒット位置が後ろにある長文は前後を '...' で切り詰める", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "long",
      conversationId: "conv-1",
      // 前後に十分な余白を置いて、両端の省略記号が付く条件を満たす。
      content: `${"あ".repeat(300)}KEYWORD${"い".repeat(300)}`,
      createdAt: 100,
    });

    const body = await readSearch(await authed(DB, "/api/conversations/search/messages?q=keyword"));

    expect(body.results[0].snippet.startsWith("...")).toBe(true);
    expect(body.results[0].snippet.endsWith("...")).toBe(true);
    expect(body.results[0].snippet).toContain("KEYWORD");
  });

  it("XMLタグは吹き出しと同じ剥がし方でスニペットから消える", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "xml",
      conversationId: "conv-1",
      content:
        "<response><action>ふっと笑みが浮かぶ。</action> <dialogue>えへへ…キスしよ</dialogue></response>",
      createdAt: 100,
    });

    const body = await readSearch(
      await authed(DB, `/api/conversations/search/messages?q=${encodeURIComponent("えへへ")}`),
    );

    expect(body.results[0].snippet).toBe("ふっと笑みが浮かぶ。 えへへ…キスしよ");
  });

  it("ヒットが後ろにある長文でも、切り出し位置は剥がした後の本文で決まる", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "xml-long",
      conversationId: "conv-1",
      // タグの文字数だけ実文がずれる。生の本文で切ると KEYWORD が窓から外れる長さにしとる。
      content: `<response><action>${"あ".repeat(300)}</action><dialogue>KEYWORD${"い".repeat(300)}</dialogue></response>`,
      createdAt: 100,
    });

    const body = await readSearch(await authed(DB, "/api/conversations/search/messages?q=keyword"));

    expect(body.results[0].snippet).toContain("KEYWORD");
    expect(body.results[0].snippet).not.toMatch(/<\/?[A-Za-z]/);
  });

  it("キャラ行が無い会話のヒットは characterName 'AI' / avatar null に落ちる", async () => {
    const { db, DB } = makeRealD1();
    seedConversation(db, { id: "conv-orphan", characterId: "char-gone" });
    seedMessage(db, {
      id: "m1",
      conversationId: "conv-orphan",
      characterId: "char-gone",
      content: "kiss",
      createdAt: 100,
    });

    const body = await readSearch(await authed(DB, "/api/conversations/search/messages?q=kiss"));

    expect(body.results[0]).toMatchObject({ characterName: "AI", characterAvatar: null });
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/conversations/:id/messages (実SQLite)", () => {
  it("認証ヘッダが無ければ 401 unauthorized", async () => {
    const { DB } = makeRealD1();

    const response = await anonymous(DB, "/api/conversations/conv-1/messages");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("id が128文字を超えると 400 invalid conversation id", async () => {
    const { DB } = makeRealD1();

    const response = await authed(DB, `/api/conversations/${TOO_LONG_ID}/messages`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid conversation id" });
  });

  it("他人の会話は 404 conversation not found で、本文を1行も返さん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
    });
    seedMessage(db, {
      id: "msg-theirs",
      userId: OTHER_ID,
      conversationId: "conv-theirs",
      characterId: OTHER_CHARACTER_ID,
      content: "秘密",
      createdAt: 100,
    });

    const response = await authed(DB, "/api/conversations/conv-theirs/messages");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "conversation not found" });
  });

  it("createdAt の昇順で返り、別会話のメッセージは混ざらん", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedConversation(db, { id: "conv-2" });
    seedMessage(db, { id: "m-late", conversationId: "conv-1", createdAt: 300 });
    seedMessage(db, { id: "m-early", conversationId: "conv-1", createdAt: 100 });
    seedMessage(db, { id: "m-mid", conversationId: "conv-1", createdAt: 200 });
    seedMessage(db, { id: "m-other-conv", conversationId: "conv-2", createdAt: 150 });

    const body = await readMessageList(await authed(DB, "/api/conversations/conv-1/messages"));

    expect(body.messages.map((m) => m.id)).toEqual(["m-early", "m-mid", "m-late"]);
  });

  it("本人のフィードバックだけが feedbackRating に載り、他人の評価は null のまま", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, { id: "m-rated", conversationId: "conv-1", createdAt: 100 });
    seedMessage(db, { id: "m-rated-by-other", conversationId: "conv-1", createdAt: 200 });
    seedMessage(db, { id: "m-unrated", conversationId: "conv-1", createdAt: 300 });
    seedFeedback(db, { messageId: "m-rated", conversationId: "conv-1", rating: "bad" });
    // 同じメッセージへ他人が付けた評価。join が userId で絞れてへんかったら漏れる。
    seedFeedback(db, {
      messageId: "m-rated-by-other",
      userId: OTHER_ID,
      conversationId: "conv-1",
      rating: "good",
    });

    const body = await readMessageList(await authed(DB, "/api/conversations/conv-1/messages"));

    expect(body.messages.map((m) => [m.id, m.feedbackRating])).toEqual([
      ["m-rated", "bad"],
      ["m-rated-by-other", null],
      ["m-unrated", null],
    ]);
  });

  it("画像・生成メタを含む全カラムを返す", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "m-full",
      conversationId: "conv-1",
      role: "assistant",
      content: "本文",
      createdAt: 100,
      imageUrl: "https://example.test/i.png",
      imageKey: "images/i.png",
      imagePrompt: "prompt",
      imageSeed: "42",
      imageLoraModel: "lora.safetensors",
      imageLoraWeight: 0.8,
      imageLoraTriggerPrompt: "trigger",
      generationModel: "model-x",
      generationPhase: "erotic",
    });

    const body = await readMessageList(await authed(DB, "/api/conversations/conv-1/messages"));

    expect(body.messages).toEqual([
      {
        id: "m-full",
        role: "assistant",
        content: "本文",
        imageUrl: "https://example.test/i.png",
        imageKey: "images/i.png",
        imagePrompt: "prompt",
        imageSeed: "42",
        imageLoraModel: "lora.safetensors",
        imageLoraWeight: 0.8,
        imageLoraTriggerPrompt: "trigger",
        createdAt: 100,
        generationModel: "model-x",
        generationPhase: "erotic",
        feedbackRating: null,
      },
    ]);
  });
});

describe.skipIf(!DatabaseSyncCtor)(
  "DELETE /api/conversations/:id/messages/:messageId (実SQLite)",
  () => {
    it("認証ヘッダが無ければ 401 で、メッセージは残る", async () => {
      const { db, DB } = makeRealD1();
      seedCharacter(db);
      seedConversation(db, { id: "conv-1" });
      seedMessage(db, { id: "m-1", conversationId: "conv-1", createdAt: 100 });

      const response = await anonymous(DB, "/api/conversations/conv-1/messages/m-1", {
        method: "DELETE",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(readMessage(db, "m-1")).toBeDefined();
    });

    it("どちらかの id が128文字を超えると 400 invalid id", async () => {
      const { DB } = makeRealD1();

      const byConversation = await authed(DB, `/api/conversations/${TOO_LONG_ID}/messages/m-1`, {
        method: "DELETE",
      });
      expect(byConversation.status).toBe(400);
      expect(await byConversation.json()).toEqual({ error: "invalid id" });

      const byMessage = await authed(DB, `/api/conversations/conv-1/messages/${TOO_LONG_ID}`, {
        method: "DELETE",
      });
      expect(byMessage.status).toBe(400);
      expect(await byMessage.json()).toEqual({ error: "invalid id" });
    });

    it("他人のメッセージは 404 で消えん", async () => {
      const { db, DB } = makeRealD1();
      seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
      seedConversation(db, {
        id: "conv-theirs",
        userId: OTHER_ID,
        characterId: OTHER_CHARACTER_ID,
      });
      seedMessage(db, {
        id: "m-theirs",
        userId: OTHER_ID,
        conversationId: "conv-theirs",
        characterId: OTHER_CHARACTER_ID,
        createdAt: 100,
      });

      const response = await authed(DB, "/api/conversations/conv-theirs/messages/m-theirs", {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "message not found" });
      expect(readMessage(db, "m-theirs")).toBeDefined();
    });

    it("会話 ID が違うメッセージは 404 で消えん", async () => {
      const { db, DB } = makeRealD1();
      seedCharacter(db);
      seedConversation(db, { id: "conv-1" });
      seedConversation(db, { id: "conv-2" });
      seedMessage(db, { id: "m-in-conv2", conversationId: "conv-2", createdAt: 100 });

      const response = await authed(DB, "/api/conversations/conv-1/messages/m-in-conv2", {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      expect(readMessage(db, "m-in-conv2")).toBeDefined();
    });

    it("自分のメッセージは1件だけ消え、会話の updatedAt が進む", async () => {
      const { db, DB } = makeRealD1();
      seedCharacter(db);
      seedConversation(db, { id: "conv-1", updatedAt: 1 });
      seedMessage(db, { id: "m-1", conversationId: "conv-1", createdAt: 100 });
      seedMessage(db, { id: "m-2", conversationId: "conv-1", createdAt: 200 });

      const response = await authed(DB, "/api/conversations/conv-1/messages/m-1", {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(readMessage(db, "m-1")).toBeUndefined();
      expect(readMessage(db, "m-2")).toBeDefined();
      expect(Number(readConversation(db, "conv-1")?.updated_at)).toBeGreaterThan(1);
    });
  },
);

describe.skipIf(!DatabaseSyncCtor)(
  "DELETE /api/conversations/:id/messages-after/:messageId (実SQLite)",
  () => {
    // pivot の会話スコープと成功系は conversation-write-integrity-realdb.test.ts が持つ。
    // ここは認証・入力検証・所有権だけを見る。
    it("認証ヘッダが無ければ 401 で、後続メッセージは残る", async () => {
      const { db, DB } = makeRealD1();
      seedCharacter(db);
      seedConversation(db, { id: "conv-1" });
      seedMessage(db, { id: "m-1", conversationId: "conv-1", createdAt: 100 });
      seedMessage(db, { id: "m-2", conversationId: "conv-1", createdAt: 200 });

      const response = await anonymous(DB, "/api/conversations/conv-1/messages-after/m-1", {
        method: "DELETE",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(countMessages(db, "conv-1")).toBe(2);
    });

    it("id が128文字を超えると 400 invalid id", async () => {
      const { DB } = makeRealD1();

      const response = await authed(DB, `/api/conversations/conv-1/messages-after/${TOO_LONG_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid id" });
    });

    it("他人の会話の pivot なら 404 で、その会話のメッセージは消えん", async () => {
      const { db, DB } = makeRealD1();
      seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
      seedConversation(db, {
        id: "conv-theirs",
        userId: OTHER_ID,
        characterId: OTHER_CHARACTER_ID,
      });
      seedMessage(db, {
        id: "m-theirs-1",
        userId: OTHER_ID,
        conversationId: "conv-theirs",
        characterId: OTHER_CHARACTER_ID,
        createdAt: 100,
      });
      seedMessage(db, {
        id: "m-theirs-2",
        userId: OTHER_ID,
        conversationId: "conv-theirs",
        characterId: OTHER_CHARACTER_ID,
        createdAt: 200,
      });

      const response = await authed(
        DB,
        "/api/conversations/conv-theirs/messages-after/m-theirs-1",
        { method: "DELETE" },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "message not found" });
      expect(countMessages(db, "conv-theirs")).toBe(2);
    });
  },
);

describe.skipIf(!DatabaseSyncCtor)("POST /api/messages/:messageId/feedback (実SQLite)", () => {
  const rate = (DB: Env, messageId: string, body: unknown) =>
    authed(DB, `/api/messages/${messageId}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    });

  const seedRatable = (db: DatabaseSync) => {
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "m-user",
      conversationId: "conv-1",
      role: "user",
      content: "直前のユーザー発言",
      createdAt: 100,
    });
    seedMessage(db, {
      id: "m-target",
      conversationId: "conv-1",
      content: "評価される返事",
      createdAt: 200,
    });
  };

  it("認証ヘッダが無ければ 401 で、行を作らん", async () => {
    const { db, DB } = makeRealD1();
    seedRatable(db);

    const response = await anonymous(DB, "/api/messages/m-target/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: "good" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(count(db, "SELECT COUNT(*) AS n FROM message_feedback")).toBe(0);
  });

  it("messageId が128文字を超えると 400 invalid message id", async () => {
    const { DB } = makeRealD1();

    const response = await rate(DB, TOO_LONG_ID, { rating: "good" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid message id" });
  });

  it("rating が enum 外なら 400 で、行を作らん", async () => {
    const { db, DB } = makeRealD1();
    seedRatable(db);

    const response = await rate(DB, "m-target", { rating: "meh" });

    expect(response.status).toBe(400);
    expect(count(db, "SELECT COUNT(*) AS n FROM message_feedback")).toBe(0);
  });

  it("他人のメッセージには評価を付けられず 404 message not found", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
    });
    seedMessage(db, {
      id: "m-theirs",
      userId: OTHER_ID,
      conversationId: "conv-theirs",
      characterId: OTHER_CHARACTER_ID,
      createdAt: 100,
    });

    const response = await rate(DB, "m-theirs", { rating: "bad", reason: "気に入らん" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "message not found" });
    expect(count(db, "SELECT COUNT(*) AS n FROM message_feedback")).toBe(0);
  });

  it("存在せんメッセージも 404 message not found", async () => {
    const { DB } = makeRealD1();

    const response = await rate(DB, "m-missing", { rating: "good" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "message not found" });
  });

  it("初回評価はメッセージ本文と直前のユーザー発言を一緒に保存する", async () => {
    const { db, DB } = makeRealD1();
    seedRatable(db);

    const response = await rate(DB, "m-target", {
      rating: "bad",
      reason: "  淡白  ",
      variantId: "v1",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const stored = readFeedback(db, "m-target");
    expect(stored).toMatchObject({
      user_id: OWNER_ID,
      conversation_id: "conv-1",
      character_id: CHARACTER_ID,
      rating: "bad",
      reason: "淡白",
      message_content: "評価される返事",
      previous_user_content: "直前のユーザー発言",
      variant_id: "v1",
    });
  });

  it("同じメッセージを二度評価しても行は1件で、内容が上書きされる", async () => {
    const { db, DB } = makeRealD1();
    seedRatable(db);

    await rate(DB, "m-target", { rating: "bad", reason: "淡白", variantId: "v1" });
    const second = await rate(DB, "m-target", {
      rating: "good",
      reason: "無視される",
      variantId: "v2",
    });

    expect(second.status).toBe(200);
    expect(count(db, "SELECT COUNT(*) AS n FROM message_feedback")).toBe(1);
    const stored = readFeedback(db, "m-target");
    expect(stored?.rating).toBe("good");
    // good では reason を捨てる（bad のときだけ理由を残す設計）。
    expect(stored?.reason).toBeNull();
    expect(stored?.variant_id).toBe("v2");
  });

  it("直前のユーザー発言は同じ会話の中からだけ拾う", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedConversation(db, { id: "conv-2" });
    seedMessage(db, {
      id: "m-other-conv-user",
      conversationId: "conv-2",
      role: "user",
      content: "別会話の発言",
      // 対象より新しくはないが、対象直前の位置に居る。会話で絞れてへんかったらこれを拾う。
      createdAt: 150,
    });
    seedMessage(db, {
      id: "m-same-conv-user",
      conversationId: "conv-1",
      role: "user",
      content: "同会話の発言",
      createdAt: 100,
    });
    seedMessage(db, { id: "m-target", conversationId: "conv-1", createdAt: 200 });

    await rate(DB, "m-target", { rating: "good" });

    expect(readFeedback(db, "m-target")?.previous_user_content).toBe("同会話の発言");
  });

  it("直前のユーザー発言が無ければ previousUserContent は null", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, { id: "m-target", conversationId: "conv-1", createdAt: 200 });

    await rate(DB, "m-target", { rating: "good" });

    expect(readFeedback(db, "m-target")?.previous_user_content).toBeNull();
  });

  it("本文は4000字、直前のユーザー発言は1000字で切られる", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "m-user",
      conversationId: "conv-1",
      role: "user",
      content: "う".repeat(1500),
      createdAt: 100,
    });
    seedMessage(db, {
      id: "m-target",
      conversationId: "conv-1",
      content: "あ".repeat(5000),
      createdAt: 200,
    });

    await rate(DB, "m-target", { rating: "good" });

    const stored = readFeedback(db, "m-target");
    expect(String(stored?.message_content)).toHaveLength(4000);
    expect(String(stored?.previous_user_content)).toHaveLength(1000);
  });

  it("reason は500字で切られ、bad のときだけ残る", async () => {
    const { db, DB } = makeRealD1();
    seedRatable(db);

    await rate(DB, "m-target", { rating: "bad", reason: "り".repeat(800) });

    expect(String(readFeedback(db, "m-target")?.reason)).toHaveLength(500);
  });
});

describe.skipIf(!DatabaseSyncCtor)("PATCH /api/messages/:messageId/image (実SQLite)", () => {
  const patchImage = (DB: Env, messageId: string, body: unknown) =>
    authed(DB, `/api/messages/${messageId}/image`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

  const seedTarget = (db: DatabaseSync) => {
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });
    seedMessage(db, {
      id: "m-1",
      conversationId: "conv-1",
      createdAt: 100,
      imageLoraModel: "old-lora",
      imageLoraWeight: 0.5,
      imageLoraTriggerPrompt: "old-trigger",
      imagePrompt: "old-prompt",
    });
  };

  it("認証ヘッダが無ければ 401 で、行は変わらん", async () => {
    const { db, DB } = makeRealD1();
    seedTarget(db);

    const response = await anonymous(DB, "/api/messages/m-1/image", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: "https://example.test/new.png" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(readMessage(db, "m-1")?.image_url).toBeNull();
  });

  it("messageId が128文字を超えると 400 invalid message id", async () => {
    const { DB } = makeRealD1();

    const response = await patchImage(DB, TOO_LONG_ID, { imageUrl: "https://example.test/x.png" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid message id" });
  });

  it("imageUrl も imageKey も無ければ 400 で、行は変わらん", async () => {
    const { db, DB } = makeRealD1();
    seedTarget(db);

    const response = await patchImage(DB, "m-1", { imagePrompt: "prompt だけ" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "imageUrl or imageKey is required" });
    expect(readMessage(db, "m-1")?.image_prompt).toBe("old-prompt");
  });

  it("imageKey が空文字だけでも 400（必須判定は truthy 判定）", async () => {
    const { DB } = makeRealD1();

    const response = await patchImage(DB, "m-1", { imageKey: "" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "imageUrl or imageKey is required" });
  });

  it("imageLoraWeight が範囲外(2超)なら 400 で弾かれる", async () => {
    const { db, DB } = makeRealD1();
    seedTarget(db);

    const response = await patchImage(DB, "m-1", {
      imageUrl: "https://example.test/new.png",
      imageLoraWeight: 3,
    });

    expect(response.status).toBe(400);
    expect(readMessage(db, "m-1")?.image_url).toBeNull();
  });

  it("imageUrl が1001文字なら 400 で弾かれる", async () => {
    const { db, DB } = makeRealD1();
    seedTarget(db);

    const response = await patchImage(DB, "m-1", { imageUrl: `https://x/${"a".repeat(1000)}` });

    expect(response.status).toBe(400);
    expect(readMessage(db, "m-1")?.image_url).toBeNull();
  });

  it("自分のメッセージなら 200 で画像カラムが入る", async () => {
    const { db, DB } = makeRealD1();
    seedTarget(db);

    const response = await patchImage(DB, "m-1", {
      imageUrl: "https://example.test/new.png",
      imageKey: "images/new.png",
      imagePrompt: "new-prompt",
      imageSeed: "99",
      imageLoraModel: "new-lora",
      imageLoraWeight: 0.9,
      imageLoraTriggerPrompt: "new-trigger",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readMessage(db, "m-1")).toMatchObject({
      image_url: "https://example.test/new.png",
      image_key: "images/new.png",
      image_prompt: "new-prompt",
      image_seed: "99",
      image_lora_model: "new-lora",
      image_lora_weight: 0.9,
      image_lora_trigger_prompt: "new-trigger",
    });
  });

  it("imageKey だけでも通る（imageUrl は据え置き）", async () => {
    const { db, DB } = makeRealD1();
    seedTarget(db);
    db.prepare("UPDATE message SET image_url = ? WHERE id = ?").run("https://old", "m-1");

    const response = await patchImage(DB, "m-1", { imageKey: "images/only-key.png" });

    expect(response.status).toBe(200);
    const stored = readMessage(db, "m-1");
    expect(stored?.image_key).toBe("images/only-key.png");
    // imageUrl は undefined なので drizzle の set から落ちて既存値が残る。
    expect(stored?.image_url).toBe("https://old");
  });

  // 現状の実装の副作用をピンで固定する。imageLoraModel/Weight/TriggerPrompt は
  // `payload.x ?? null` で常に set に載るため、LoRA を送らん PATCH が既存の
  // LoRA メタを null で潰す。一方 imagePrompt/imageSeed は undefined のまま
  // set から落ちるので残る。この非対称は routes/conversations.ts:669-679 由来。
  it("LoRA を送らん PATCH は既存の LoRA メタを消すが、imagePrompt は残る", async () => {
    const { db, DB } = makeRealD1();
    seedTarget(db);

    const response = await patchImage(DB, "m-1", { imageUrl: "https://example.test/new.png" });

    expect(response.status).toBe(200);
    const stored = readMessage(db, "m-1");
    expect(stored?.image_lora_model).toBeNull();
    expect(stored?.image_lora_weight).toBeNull();
    expect(stored?.image_lora_trigger_prompt).toBeNull();
    expect(stored?.image_prompt).toBe("old-prompt");
  });

  // 所有権は WHERE で担保されとるが、0件更新でも 200 {ok:true} を返す。
  // クライアントからは「更新できた」と区別が付かん。挙動としてピンしとく。
  it("他人のメッセージは書き換わらんが、応答は 200 {ok:true} のまま", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db, { id: OTHER_CHARACTER_ID, userId: OTHER_ID, name: "他人キャラ" });
    seedConversation(db, {
      id: "conv-theirs",
      userId: OTHER_ID,
      characterId: OTHER_CHARACTER_ID,
    });
    seedMessage(db, {
      id: "m-theirs",
      userId: OTHER_ID,
      conversationId: "conv-theirs",
      characterId: OTHER_CHARACTER_ID,
      createdAt: 100,
    });

    const response = await patchImage(DB, "m-theirs", {
      imageUrl: "https://example.test/evil.png",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readMessage(db, "m-theirs")?.image_url).toBeNull();
  });

  it("存在せんメッセージでも 200 {ok:true} を返す（0件更新を成功として返す）", async () => {
    const { DB } = makeRealD1();

    const response = await patchImage(DB, "m-missing", { imageUrl: "https://example.test/x.png" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe.skipIf(!DatabaseSyncCtor)("PATCH /api/messages/:messageId/content (実SQLite)", () => {
  const ORIGINAL_CONTENT = `<response><dialogue>元のセリフ</dialogue><remember>大事な約束</remember></response>`;
  const REGENERATED_CONTENT = `<response><dialogue>別の返答</dialogue><remember>新しい約束</remember></response>`;

  const readMemoryNotes = (db: DatabaseSync, sourceMessageId: string) =>
    db
      .prepare("SELECT * FROM memory_note WHERE source_message_id = ?")
      .all(sourceMessageId) as Record<string, unknown>[];

  const readAllMemoryNotes = (db: DatabaseSync) =>
    db.prepare("SELECT * FROM memory_note").all() as Record<string, unknown>[];

  it("再生成しても手編集済み memory_note は巻き戻らず、新しい remember も追加される", async () => {
    const { db, DB } = makeRealD1();
    seedCharacter(db);
    seedConversation(db, { id: "conv-1" });

    // 初回 assistant 応答を作成。remember タグから memory_note が作られる。
    const postResponse = await authed(DB, "/api/conversations/conv-1/messages", {
      method: "POST",
      body: JSON.stringify({ id: "msg-1", role: "assistant", content: ORIGINAL_CONTENT }),
    });
    expect(postResponse.status).toBe(201);

    const notesBefore = readMemoryNotes(db, "msg-1");
    expect(notesBefore).toHaveLength(1);
    expect(notesBefore[0]?.content).toBe("大事な約束");
    const noteId = notesBefore[0]?.id as string;

    // ユーザーが memory_note を手編集。source_message_id が切り離される。
    await authed(DB, `/api/memory-notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "手で書き換えた大事な約束" }),
    });

    // 同じメッセージを再生成。
    const patchResponse = await authed(DB, "/api/messages/msg-1/content", {
      method: "PATCH",
      body: JSON.stringify({ content: REGENERATED_CONTENT }),
    });
    expect(patchResponse.status).toBe(200);

    // 手編集済みノートは source_message_id が NULL になって残る。
    const allNotes = readAllMemoryNotes(db);
    expect(allNotes).toHaveLength(2);
    const editedNote = allNotes.find((n) => n.id === noteId);
    expect(editedNote?.content).toBe("手で書き換えた大事な約束");
    expect(editedNote?.source_message_id).toBeNull();

    const newNote = allNotes.find((n) => n.id !== noteId);
    expect(newNote?.content).toBe("新しい約束");
    expect(newNote?.source_message_id).toBe("msg-1");
  });
});
