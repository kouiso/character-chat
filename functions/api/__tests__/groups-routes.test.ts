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

// 所有権と削除は「行が実際に残るか / 消えるか」でしか確かめられん。SQL 文字列を見るモックやと
// DELETE の WHERE から user_id が落ちても気付けんので、書き込みも走る実SQLiteに繋ぐ。
const AUTH_TOKEN = "test-token";
// getUserEmail は Bearer 一致で LOCAL_USER_EMAIL を返し、ensureUser はそれをそのまま userId にする。
const OWNER_ID = "sukererion@gmail.com";
const INTRUDER_ID = "attacker@example.com";
const AUTH_HEADERS = { Authorization: `Bearer ${AUTH_TOKEN}` };
const JSON_HEADERS = { ...AUTH_HEADERS, "Content-Type": "application/json" };

type TestHarness = { db: DatabaseSync; DB: unknown };

// response.json() は unknown を返すため、代入側で形を宣言する
// （as だと eslint の no-unnecessary-type-assertion が外しにきて tsc と衝突する）。
type GroupBody = {
  id: string;
  name: string;
  characterIds: string[];
  scenario: string | null;
  createdAt: number;
  characters: { id: string; name: string }[];
};
type GroupEnvelope = { group: GroupBody };
type GroupListEnvelope = { groups: GroupBody[]; nextCursor: string | null };
type GroupMessageBody = {
  id: string;
  groupId: string;
  role: string;
  speakerCharacterId: string | null;
  content: string;
  imageUrl: string | null;
  imageKey: string | null;
  createdAt: number;
};
type GroupMessageListEnvelope = { messages: GroupMessageBody[]; nextCursor: string | null };

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
    CREATE TABLE chat_group (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      character_ids TEXT NOT NULL, scenario TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE group_message (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, speaker_character_id TEXT, content TEXT NOT NULL,
      image_url TEXT, image_key TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE request_counter (
      user_id TEXT NOT NULL, period TEXT NOT NULL, counter_type TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, period, counter_type)
    );
    CREATE TABLE usage_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, model TEXT,
      estimated_cost_cents INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
  `);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(OWNER_ID, OWNER_ID);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(INTRUDER_ID, INTRUDER_ID);

  const wrap = (sql: string, args: unknown[]) => {
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const returnsRows = /^\s*select/i.test(sql) || /\breturning\b/i.test(sql);
    // RETURNING 付きの書き込みを二度実行せんよう、結果は一度だけ取って使い回す。
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
      // enforceRateLimit は env.DB.batch() の meta.changes で予約成否を判定するため、
      // batch から SQL と bind をそのまま実行できるよう素の材料を持たせておく。
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

const envOf = (harness: TestHarness) => ({
  AUTH_TOKEN,
  DB: harness.DB,
  OPENROUTER_API_KEY: "",
  NOVITA_API_KEY: "",
});

const insertCharacter = (db: DatabaseSync, id: string, userId: string, name: string) => {
  db.prepare(
    "INSERT INTO character (id, user_id, name, system_prompt, greeting, tags) VALUES (?, ?, ?, ?, ?, '[]')",
  ).run(id, userId, name, `${name} のプロンプト`, `${name} やで`);
};

const insertGroup = (
  db: DatabaseSync,
  id: string,
  userId: string,
  characterIds: string[],
  createdAt = 1_000,
  name = id,
) => {
  db.prepare(
    "INSERT INTO chat_group (id, user_id, name, character_ids, scenario, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
  ).run(id, userId, name, JSON.stringify(characterIds), createdAt);
};

const insertGroupMessage = (
  db: DatabaseSync,
  id: string,
  groupId: string,
  userId: string,
  createdAt: number,
) => {
  db.prepare(
    "INSERT INTO group_message (id, group_id, user_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)",
  ).run(id, groupId, userId, id, createdAt);
};

const countRows = (db: DatabaseSync, sql: string, ...binds: string[]): number =>
  (db.prepare(sql).get(...binds) as { n: number }).n;

const countGroups = (db: DatabaseSync) => countRows(db, "SELECT COUNT(*) AS n FROM chat_group");
const countGroupMessages = (db: DatabaseSync, groupId: string) =>
  countRows(db, "SELECT COUNT(*) AS n FROM group_message WHERE group_id = ?", groupId);

const seedTwoOwnedCharacters = (db: DatabaseSync) => {
  insertCharacter(db, "char-a", OWNER_ID, "あかり");
  insertCharacter(db, "char-b", OWNER_ID, "ひなた");
};

const postGroup = (harness: TestHarness, body: unknown, authed = true) =>
  app.request(
    "/api/groups",
    {
      method: "POST",
      headers: authed ? JSON_HEADERS : { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    envOf(harness),
  );

const sendGroupMessage = (harness: TestHarness, groupId: string, body: unknown, authed = true) =>
  app.request(
    `/api/groups/${groupId}/messages`,
    {
      method: "POST",
      headers: authed ? JSON_HEADERS : { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    envOf(harness),
  );

describe.skipIf(!DatabaseSyncCtor)("POST /api/groups", () => {
  it("未認証なら 401 を返し、グループ行を作らん", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(
      harness,
      { name: "放課後", characterIds: ["char-a", "char-b"] },
      false,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countGroups(harness.db)).toBe(0);
  });

  it("characterIds が重複しとったら 400 duplicate character ids", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "放課後",
      characterIds: ["char-a", "char-a"],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "duplicate character ids" });
    expect(countGroups(harness.db)).toBe(0);
  });

  it("characterIds が 1 件だけなら zod が 400 で弾く", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, { name: "ふたり", characterIds: ["char-a"] });

    expect(response.status).toBe(400);
    expect(countGroups(harness.db)).toBe(0);
  });

  it("characterIds が 5 件なら zod が 400 で弾く", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "大人数",
      characterIds: ["c1", "c2", "c3", "c4", "c5"],
    });

    expect(response.status).toBe(400);
    expect(countGroups(harness.db)).toBe(0);
  });

  it("name が空文字なら zod が 400 で弾く", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "   ",
      characterIds: ["char-a", "char-b"],
    });

    expect(response.status).toBe(400);
    expect(countGroups(harness.db)).toBe(0);
  });

  it("name が未成年ワードを含んどったら 403 content_blocked", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "中学生の教室",
      characterIds: ["char-a", "char-b"],
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "content_blocked: prohibited_minor_content" });
    expect(countGroups(harness.db)).toBe(0);
  });

  it("scenario 側の禁止ワードも 403 で拾う（name だけ見とらんこと）", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "放課後",
      characterIds: ["char-a", "char-b"],
      scenario: "実在の芸能人として振る舞う",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "content_blocked: prohibited_real_person" });
    expect(countGroups(harness.db)).toBe(0);
  });

  it("他人のキャラを混ぜたら 404 character not found でグループを作らせん", async () => {
    const harness = makeRealD1();
    insertCharacter(harness.db, "char-a", OWNER_ID, "あかり");
    insertCharacter(harness.db, "char-intruder", INTRUDER_ID, "他人のキャラ");

    const response = await postGroup(harness, {
      name: "乗っ取り",
      characterIds: ["char-a", "char-intruder"],
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
    expect(countGroups(harness.db)).toBe(0);
  });

  it("存在しないキャラ ID でも 404 character not found", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "幽霊",
      characterIds: ["char-a", "char-nonexistent"],
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
    expect(countGroups(harness.db)).toBe(0);
  });

  it("自分のキャラだけなら 201 で、レスポンス形と保存行の両方が揃う", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "放課後の部室",
      characterIds: ["char-a", "char-b"],
      scenario: "夕方の部室でふたりきり",
    });

    expect(response.status).toBe(201);
    const body: GroupEnvelope = await response.json();
    expect(body.group.name).toBe("放課後の部室");
    expect(body.group.characterIds).toEqual(["char-a", "char-b"]);
    expect(body.group.scenario).toBe("夕方の部室でふたりきり");
    expect(typeof body.group.createdAt).toBe("number");
    // characters は characterIds の順に解決される（名前解決が並び順ごと壊れとらんこと）。
    expect(body.group.characters.map((character) => character.id)).toEqual(["char-a", "char-b"]);
    expect(body.group.characters.map((character) => character.name)).toEqual(["あかり", "ひなた"]);

    const stored = harness.db.prepare("SELECT * FROM chat_group").get() as {
      id: string;
      user_id: string;
      character_ids: string;
      scenario: string | null;
    };
    expect(stored.id).toBe(body.group.id);
    expect(stored.user_id).toBe(OWNER_ID);
    expect(JSON.parse(stored.character_ids)).toEqual(["char-a", "char-b"]);
    expect(stored.scenario).toBe("夕方の部室でふたりきり");
  });

  it("scenario 省略時は null として返し、null で保存する", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);

    const response = await postGroup(harness, {
      name: "雑談",
      characterIds: ["char-a", "char-b"],
    });

    expect(response.status).toBe(201);
    const body: GroupEnvelope = await response.json();
    expect(body.group.scenario).toBeNull();
    const stored = harness.db.prepare("SELECT scenario FROM chat_group").get() as {
      scenario: string | null;
    };
    expect(stored.scenario).toBeNull();
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/groups", () => {
  it("未認証なら 401", async () => {
    const harness = makeRealD1();
    const response = await app.request("/api/groups", {}, envOf(harness));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("他人のグループを混ぜず、createdAt の降順で返す", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);
    insertGroup(harness.db, "group-old", OWNER_ID, ["char-a", "char-b"], 100);
    insertGroup(harness.db, "group-new", OWNER_ID, ["char-a", "char-b"], 900);
    insertGroup(harness.db, "group-intruder", INTRUDER_ID, [], 500);

    const response = await app.request("/api/groups", { headers: AUTH_HEADERS }, envOf(harness));

    expect(response.status).toBe(200);
    const body: GroupListEnvelope = await response.json();
    expect(body.groups.map((group) => group.id)).toEqual(["group-new", "group-old"]);
    expect(body.nextCursor).toBeNull();
  });

  it("グループが 1 件も無ければ空配列を返す", async () => {
    const harness = makeRealD1();
    const response = await app.request("/api/groups", { headers: AUTH_HEADERS }, envOf(harness));

    expect(response.status).toBe(200);
    const body: GroupListEnvelope = await response.json();
    expect(body.groups).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/groups/:id", () => {
  it("未認証なら 401", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await app.request("/api/groups/group-a", {}, envOf(harness));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("id が 128 文字を超えとったら 400 invalid group id", async () => {
    const harness = makeRealD1();
    const longId = "g".repeat(129);

    const response = await app.request(
      `/api/groups/${longId}`,
      { headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid group id" });
  });

  it("他人のグループ ID を当てられても 404 group not found", async () => {
    const harness = makeRealD1();
    insertCharacter(harness.db, "char-intruder", INTRUDER_ID, "他人のキャラ");
    insertGroup(harness.db, "group-intruder", INTRUDER_ID, ["char-intruder"]);

    const response = await app.request(
      "/api/groups/group-intruder",
      { headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "group not found" });
  });

  it("自分のグループなら 200 でキャラ解決込みの形を返す", async () => {
    const harness = makeRealD1();
    seedTwoOwnedCharacters(harness.db);
    insertGroup(harness.db, "group-a", OWNER_ID, ["char-a", "char-b"], 4_200, "部室");

    const response = await app.request(
      "/api/groups/group-a",
      { headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(200);
    const body: GroupEnvelope = await response.json();
    expect(body.group.id).toBe("group-a");
    expect(body.group.name).toBe("部室");
    expect(body.group.characterIds).toEqual(["char-a", "char-b"]);
    expect(body.group.scenario).toBeNull();
    expect(body.group.createdAt).toBe(4_200);
    expect(body.group.characters.map((character) => character.id)).toEqual(["char-a", "char-b"]);
  });

  it("メンバーが他人のキャラでも、そのキャラ設定は characters に載せん", async () => {
    // characterIds は行にそのまま入っとるので、キャラ解決側で user_id を見んと
    // 他人の systemPrompt / greeting が API 越しに読める。
    const harness = makeRealD1();
    insertCharacter(harness.db, "char-a", OWNER_ID, "あかり");
    insertCharacter(harness.db, "char-intruder", INTRUDER_ID, "他人のキャラ");
    insertGroup(harness.db, "group-a", OWNER_ID, ["char-a", "char-intruder"]);

    const response = await app.request(
      "/api/groups/group-a",
      { headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(200);
    const body: GroupEnvelope = await response.json();
    expect(body.group.characters.map((character) => character.id)).toEqual(["char-a"]);
  });
});

describe.skipIf(!DatabaseSyncCtor)("DELETE /api/groups/:id", () => {
  it("未認証なら 401 で、行は残る", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await app.request("/api/groups/group-a", { method: "DELETE" }, envOf(harness));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countGroups(harness.db)).toBe(1);
  });

  it("id が 128 文字を超えとったら 400 invalid group id", async () => {
    const harness = makeRealD1();
    const response = await app.request(
      `/api/groups/${"g".repeat(129)}`,
      { method: "DELETE", headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid group id" });
  });

  it("他人のグループを消させん（200 を返しても行とメッセージは残る）", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-intruder", INTRUDER_ID, []);
    insertGroupMessage(harness.db, "msg-intruder", "group-intruder", INTRUDER_ID, 100);

    const response = await app.request(
      "/api/groups/group-intruder",
      { method: "DELETE", headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(404);
    expect(countGroups(harness.db)).toBe(1);
    expect(countGroupMessages(harness.db, "group-intruder")).toBe(1);
  });

  it("自分のグループなら本体とメッセージを消し、他グループのメッセージは残す", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);
    insertGroup(harness.db, "group-b", OWNER_ID, []);
    insertGroupMessage(harness.db, "msg-a1", "group-a", OWNER_ID, 100);
    insertGroupMessage(harness.db, "msg-a2", "group-a", OWNER_ID, 200);
    insertGroupMessage(harness.db, "msg-b1", "group-b", OWNER_ID, 150);

    const response = await app.request(
      "/api/groups/group-a",
      { method: "DELETE", headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(countGroupMessages(harness.db, "group-a")).toBe(0);
    expect(countGroupMessages(harness.db, "group-b")).toBe(1);
    expect(countGroups(harness.db)).toBe(1);
  });

  it("存在しない ID なら DELETE は 404 を返す", async () => {
    const harness = makeRealD1();
    const response = await app.request(
      "/api/groups/group-missing",
      { method: "DELETE", headers: AUTH_HEADERS },
      envOf(harness),
    );

    expect(response.status).toBe(404);
  });
});

// モデル呼び出しの手前で返る分岐だけを見る。ストリーム本体（createGroupReply 以降）は
// upstream を叩くので、この HTTP 契約テストの対象外にしとる。
describe.skipIf(!DatabaseSyncCtor)("POST /api/groups/:id/messages（モデル手前の分岐のみ）", () => {
  it("未認証なら 401 で、メッセージ行を作らん", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await sendGroupMessage(harness, "group-a", { content: "こんばんは" }, false);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countGroupMessages(harness.db, "group-a")).toBe(0);
  });

  it("content が空なら zod が 400 で弾く", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await sendGroupMessage(harness, "group-a", { content: "   " });

    expect(response.status).toBe(400);
    expect(countGroupMessages(harness.db, "group-a")).toBe(0);
  });

  it("imageHint が 500 文字を超えたら zod が 400 で弾く", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await sendGroupMessage(harness, "group-a", {
      content: "こんばんは",
      imageHint: "あ".repeat(501),
    });

    expect(response.status).toBe(400);
    expect(countGroupMessages(harness.db, "group-a")).toBe(0);
  });

  it("id が 128 文字を超えとったら 400 invalid group id", async () => {
    const harness = makeRealD1();

    const response = await sendGroupMessage(harness, "g".repeat(129), { content: "こんばんは" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid group id" });
  });

  it("content が未成年ワードを含んどったら 403 content_blocked", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await sendGroupMessage(harness, "group-a", { content: "中学生の話をして" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "content_blocked: prohibited_minor_content" });
    expect(countGroupMessages(harness.db, "group-a")).toBe(0);
  });

  it("imageHint 側の禁止ワードも 403 で拾う（content だけ見とらんこと）", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await sendGroupMessage(harness, "group-a", {
      content: "こんばんは",
      imageHint: "ロリ",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "content_blocked: prohibited_minor_content" });
  });

  it("他人のグループ宛なら 404 group not found で、その行に書き込ません", async () => {
    const harness = makeRealD1();
    insertCharacter(harness.db, "char-intruder", INTRUDER_ID, "他人のキャラ");
    insertGroup(harness.db, "group-intruder", INTRUDER_ID, ["char-intruder"]);

    const response = await sendGroupMessage(harness, "group-intruder", { content: "こんばんは" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "group not found" });
    expect(countGroupMessages(harness.db, "group-intruder")).toBe(0);
  });

  it("存在しないグループでも 404 group not found", async () => {
    const harness = makeRealD1();

    const response = await sendGroupMessage(harness, "group-missing", { content: "こんばんは" });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "group not found" });
  });

  it("レート上限に達しとったら 429 rate_limited で、所有権判定まで進まん", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);
    const dailyPeriod = new Date().toISOString().slice(0, 10);
    harness.db
      .prepare(
        "INSERT INTO request_counter (user_id, period, counter_type, value) VALUES (?, ?, 'daily_count', ?)",
      )
      .run(OWNER_ID, dailyPeriod, 500);

    const response = await sendGroupMessage(harness, "group-a", { content: "こんばんは" });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limited: rate_limit_exceeded" });
    expect(countGroupMessages(harness.db, "group-a")).toBe(0);
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/groups/:id/messages", () => {
  const listMessages = (harness: TestHarness, groupId: string, query = "", authed = true) =>
    app.request(
      `/api/groups/${groupId}/messages${query}`,
      authed ? { headers: AUTH_HEADERS } : {},
      envOf(harness),
    );

  it("未認証なら 401", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await listMessages(harness, "group-a", "", false);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("他人のグループのメッセージは 404 で読ません", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-intruder", INTRUDER_ID, []);
    insertGroupMessage(harness.db, "msg-secret", "group-intruder", INTRUDER_ID, 100);

    const response = await listMessages(harness, "group-intruder");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "group not found" });
  });

  it("自分のグループでも、他人の user_id が付いた行は返さん", async () => {
    // group_id だけで引くと、同じグループに紛れ込んだ他人の行まで読める。
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);
    insertGroupMessage(harness.db, "msg-mine", "group-a", OWNER_ID, 100);
    insertGroupMessage(harness.db, "msg-theirs", "group-a", INTRUDER_ID, 200);

    const response = await listMessages(harness, "group-a");

    expect(response.status).toBe(200);
    const body: GroupMessageListEnvelope = await response.json();
    expect(body.messages.map((message) => message.id)).toEqual(["msg-mine"]);
  });

  it("id が 128 文字を超えとったら 400 invalid group id", async () => {
    const harness = makeRealD1();

    const response = await listMessages(harness, "g".repeat(129));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid group id" });
  });

  it.each(["?limit=0", "?limit=101", "?limit=abc", "?limit=1.5", "?cursor=0", "?cursor=-1"])(
    "不正なクエリ %s は 400 で弾く",
    async (query) => {
      const harness = makeRealD1();
      insertGroup(harness.db, "group-a", OWNER_ID, []);

      const response = await listMessages(harness, "group-a", query);

      expect(response.status).toBe(400);
    },
  );

  it("メッセージが無ければ空配列と nextCursor: null", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);

    const response = await listMessages(harness, "group-a");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ messages: [], nextCursor: null });
  });

  it("既定では古い順に並べて返し、行の形をそのまま出す", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);
    insertGroupMessage(harness.db, "msg-1", "group-a", OWNER_ID, 100);
    insertGroupMessage(harness.db, "msg-2", "group-a", OWNER_ID, 200);

    const response = await listMessages(harness, "group-a");

    expect(response.status).toBe(200);
    const body: GroupMessageListEnvelope = await response.json();
    expect(body.messages.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
    expect(body.nextCursor).toBeNull();
    // user_id は返さん（列を足した時に漏らさんための固定）。
    expect(Object.keys(body.messages[0]).sort()).toEqual([
      "content",
      "createdAt",
      "groupId",
      "id",
      "imageKey",
      "imageUrl",
      "role",
      "speakerCharacterId",
    ]);
  });

  it("limit で切って nextCursor を返し、その cursor で続きが取れる", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);
    for (const [index, id] of ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"].entries()) {
      insertGroupMessage(harness.db, id, "group-a", OWNER_ID, (index + 1) * 100);
    }

    const firstPage = await listMessages(harness, "group-a", "?limit=2");
    expect(firstPage.status).toBe(200);
    const first: GroupMessageListEnvelope = await firstPage.json();
    // 新しい 2 件を取り、返す時だけ昇順に直す。nextCursor は (createdAt|id) 形式。
    expect(first.messages.map((message) => message.id)).toEqual(["msg-4", "msg-5"]);
    expect(first.nextCursor).toBe("400|msg-4");

    const secondPage = await listMessages(
      harness,
      "group-a",
      `?limit=2&cursor=${encodeURIComponent(String(first.nextCursor))}`,
    );
    const second: GroupMessageListEnvelope = await secondPage.json();
    expect(second.messages.map((message) => message.id)).toEqual(["msg-2", "msg-3"]);
    expect(second.nextCursor).toBe("200|msg-2");

    const lastPage = await listMessages(
      harness,
      "group-a",
      `?limit=2&cursor=${encodeURIComponent(String(second.nextCursor))}`,
    );
    const last: GroupMessageListEnvelope = await lastPage.json();
    // 残り 1 件で limit に満たんので、ここで打ち止め。
    expect(last.messages.map((message) => message.id)).toEqual(["msg-1"]);
    expect(last.nextCursor).toBeNull();
  });

  it("件数が limit ちょうどなら nextCursor は null（空ページを踏ません）", async () => {
    const harness = makeRealD1();
    insertGroup(harness.db, "group-a", OWNER_ID, []);
    insertGroupMessage(harness.db, "msg-1", "group-a", OWNER_ID, 100);
    insertGroupMessage(harness.db, "msg-2", "group-a", OWNER_ID, 200);

    const response = await listMessages(harness, "group-a", "?limit=2");

    const body: GroupMessageListEnvelope = await response.json();
    expect(body.messages).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });
});
