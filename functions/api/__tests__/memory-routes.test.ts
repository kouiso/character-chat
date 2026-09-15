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

// memory note は局長が手で書いた記憶そのもので、誤って消える/他人に見えるのが最悪の事故。
// SQL 文字列を見るモックでは「行が本当に残ったか」を観測でけへんので実 SQLite に繋ぐ。
const AUTH_TOKEN = "test-token";
// ensureUser は userId としてメールをそのまま返す。
const USER_EMAIL = "sukererion@gmail.com";
const USER_ID = USER_EMAIL;
const OTHER_USER_ID = "intruder@example.com";
const CHARACTER_ID = "char-mine";
const OTHER_CHARACTER_ID = "char-theirs";

type NoteRow = {
  id: string;
  user_id: string;
  character_id: string;
  content: string;
  source_message_id: string | null;
  created_at: number;
  edited_at: number | null;
  last_used_at: number | null;
  usage_count: number;
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
    CREATE TABLE memory_note (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
      content TEXT NOT NULL, source_message_id TEXT, created_at INTEGER NOT NULL,
      edited_at INTEGER, last_used_at INTEGER, usage_count INTEGER NOT NULL DEFAULT 0
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

const insertNote = (
  db: DatabaseSync,
  note: { id: string; userId: string; characterId: string; content: string; createdAt: number },
) => {
  db.prepare(
    "INSERT INTO memory_note (id, user_id, character_id, content, created_at, usage_count) VALUES (?, ?, ?, ?, ?, 0)",
  ).run(note.id, note.userId, note.characterId, note.content, note.createdAt);
};

const readNote = (db: DatabaseSync, id: string): NoteRow | undefined =>
  db.prepare("SELECT * FROM memory_note WHERE id = ?").get(id) as NoteRow | undefined;

const countNotes = (db: DatabaseSync): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM memory_note").get() as { n: number }).n;

type ResponseNote = {
  id: string;
  characterId: string;
  content: string;
  sourceMessageId: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  usageCount: number;
  characterName: string | null;
  characterAvatar: string | null;
};

const authHeaders = { Authorization: `Bearer ${AUTH_TOKEN}` };
const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

describe.skipIf(!DatabaseSyncCtor)("GET /api/memory-notes", () => {
  it("未認証なら 401 unauthorized を返し、他人のノートを一切載せん", async () => {
    const { db, DB } = makeRealD1();
    insertNote(db, {
      id: "note-mine",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "俺の記憶",
      createdAt: 100,
    });

    const response = await app.request("/api/memory-notes", {}, { AUTH_TOKEN, DB });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("自分のノートだけを createdAt 降順で返し、他人のノートは混ざらん", async () => {
    const { db, DB } = makeRealD1();
    insertNote(db, {
      id: "note-old",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "古い記憶",
      createdAt: 100,
    });
    insertNote(db, {
      id: "note-new",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "新しい記憶",
      createdAt: 300,
    });
    insertNote(db, {
      id: "note-intruder",
      userId: OTHER_USER_ID,
      characterId: OTHER_CHARACTER_ID,
      content: "他人の記憶",
      createdAt: 200,
    });

    const response = await app.request(
      "/api/memory-notes",
      { headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    const body: { notes: ResponseNote[] } = await response.json();
    expect(body.notes.map((note) => note.id)).toEqual(["note-new", "note-old"]);
    // userId を含めん・キャラ名/アバターを join して返す、が API の契約。
    expect(body.notes[0]).toEqual({
      id: "note-new",
      characterId: CHARACTER_ID,
      content: "新しい記憶",
      sourceMessageId: null,
      createdAt: 300,
      lastUsedAt: null,
      usageCount: 0,
      characterName: "みお",
      characterAvatar: "https://cdn.example/mio.png",
    });
  });

  it("characterId クエリで絞ると、同じ持ち主の別キャラのノートは返さん", async () => {
    const { db, DB } = makeRealD1();
    db.prepare("INSERT INTO character (id, user_id, name) VALUES (?, ?, ?)").run(
      "char-mine-2",
      USER_ID,
      "もう一人",
    );
    insertNote(db, {
      id: "note-a",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "Aの記憶",
      createdAt: 100,
    });
    insertNote(db, {
      id: "note-b",
      userId: USER_ID,
      characterId: "char-mine-2",
      content: "Bの記憶",
      createdAt: 200,
    });

    const response = await app.request(
      `/api/memory-notes?characterId=${CHARACTER_ID}`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    const body: { notes: ResponseNote[] } = await response.json();
    expect(body.notes.map((note) => note.id)).toEqual(["note-a"]);
  });

  it("characterId で他人のキャラを指定しても、他人のノートは出てこん", async () => {
    const { db, DB } = makeRealD1();
    insertNote(db, {
      id: "note-intruder",
      userId: OTHER_USER_ID,
      characterId: OTHER_CHARACTER_ID,
      content: "他人の記憶",
      createdAt: 200,
    });

    const response = await app.request(
      `/api/memory-notes?characterId=${OTHER_CHARACTER_ID}`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notes: [] });
  });

  it("キャラ行が消えとるノートは characterName を AI に落とす（join が null でも返す）", async () => {
    const { db, DB } = makeRealD1();
    insertNote(db, {
      id: "note-orphan",
      userId: USER_ID,
      characterId: "char-deleted",
      content: "持ち主のおらん記憶",
      createdAt: 100,
    });

    const response = await app.request(
      "/api/memory-notes",
      { headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    const body: { notes: ResponseNote[] } = await response.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].characterName).toBe("AI");
    expect(body.notes[0].characterAvatar).toBeNull();
  });
});

describe.skipIf(!DatabaseSyncCtor)("POST /api/memory-notes", () => {
  it("未認証なら 401 で、行を作らん", async () => {
    const { db, DB } = makeRealD1();

    const response = await app.request(
      "/api/memory-notes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: CHARACTER_ID, content: "覚えといて" }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countNotes(db)).toBe(0);
  });

  it("自分のキャラなら 201 で行が残り、content は trim されて保存される", async () => {
    const { db, DB } = makeRealD1();

    const response = await app.request(
      "/api/memory-notes",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ characterId: CHARACTER_ID, content: "  海が好き  " }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(201);
    const body: { note: Record<string, unknown> } = await response.json();
    expect(body.note).toEqual({
      id: expect.any(String),
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "海が好き",
      sourceMessageId: null,
      createdAt: expect.any(Number),
      lastUsedAt: null,
      usageCount: 0,
      characterName: null,
      characterAvatar: null,
    });

    const stored = readNote(db, body.note.id as string);
    expect(stored?.content).toBe("海が好き");
    expect(stored?.user_id).toBe(USER_ID);
    expect(stored?.usage_count).toBe(0);
    expect(countNotes(db)).toBe(1);
  });

  it("他人のキャラ ID を渡されても行を作らず character not found を返す", async () => {
    const { db, DB } = makeRealD1();

    const response = await app.request(
      "/api/memory-notes",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ characterId: OTHER_CHARACTER_ID, content: "他人のキャラに書く" }),
      },
      { AUTH_TOKEN, DB },
    );

    // 存在自体を伏せるため 403 やのうて 404。sibling の /api/memory/extract と同じ形。
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
    expect(countNotes(db)).toBe(0);
  });

  it("存在せんキャラ ID も character not found で弾く", async () => {
    const { db, DB } = makeRealD1();

    const response = await app.request(
      "/api/memory-notes",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ characterId: "char-nope", content: "誰の記憶やこれ" }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "character not found" });
    expect(countNotes(db)).toBe(0);
  });

  it.each([
    ["content が空", { characterId: CHARACTER_ID, content: "" }],
    ["content が空白だけ", { characterId: CHARACTER_ID, content: "   " }],
    ["content が 1000 文字超", { characterId: CHARACTER_ID, content: "あ".repeat(1001) }],
    ["characterId が無い", { content: "キャラ未指定" }],
    ["characterId が 128 文字超", { characterId: "c".repeat(129), content: "長すぎるID" }],
  ])("%s なら 400 で行を作らん", async (_label, payload) => {
    const { db, DB } = makeRealD1();

    const response = await app.request(
      "/api/memory-notes",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(400);
    expect(countNotes(db)).toBe(0);
  });

  it.each([
    ["未成年を示唆する語", "中学生のころの話", "prohibited_minor_content"],
    ["実在人物を示唆する語", "実在の芸能人がモデル", "prohibited_real_person"],
  ])("%s は 403 content_blocked で行を作らん", async (_label, content, reason) => {
    const { db, DB } = makeRealD1();

    const response = await app.request(
      "/api/memory-notes",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ characterId: CHARACTER_ID, content }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: `content_blocked: ${reason}` });
    expect(countNotes(db)).toBe(0);
  });
});

describe.skipIf(!DatabaseSyncCtor)("PATCH /api/memory-notes/:noteId", () => {
  const seedOwnNote = () => {
    const fixture = makeRealD1();
    insertNote(fixture.db, {
      id: "note-mine",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "元の記憶",
      createdAt: 100,
    });
    return fixture;
  };

  it("未認証なら 401 で、本文は書き換わらん", async () => {
    const { db, DB } = seedOwnNote();

    const response = await app.request(
      "/api/memory-notes/note-mine",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "乗っ取り" }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(readNote(db, "note-mine")?.content).toBe("元の記憶");
  });

  it("自分のノートなら 200 ok:true で本文が実際に更新される", async () => {
    const { db, DB } = seedOwnNote();

    const response = await app.request(
      "/api/memory-notes/note-mine",
      {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ content: "  新しい記憶  " }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readNote(db, "note-mine")?.content).toBe("新しい記憶");
  });

  it("他人のノートは本文が一切書き換わらん", async () => {
    const { db, DB } = makeRealD1();
    insertNote(db, {
      id: "note-intruder",
      userId: OTHER_USER_ID,
      characterId: OTHER_CHARACTER_ID,
      content: "他人の記憶",
      createdAt: 100,
    });

    const response = await app.request(
      "/api/memory-notes/note-intruder",
      { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ content: "書き換えたる" }) },
      { AUTH_TOKEN, DB },
    );

    // 行が守られとることがここでの本質。WHERE に userId が入っとるので他人の記憶は無傷。
    expect(readNote(db, "note-intruder")?.content).toBe("他人の記憶");
    // 以前は 0 件一致でも 200 {ok:true} を返しとった。クライアント(updateMemoryNote)は
    // response.ok しか見んので、保存でけてへん編集を保存済みとして表示してまう。
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "memory note not found" });
  });

  it("存在せん noteId でも他人の行を巻き込まん", async () => {
    const { db, DB } = makeRealD1();
    insertNote(db, {
      id: "note-intruder",
      userId: OTHER_USER_ID,
      characterId: OTHER_CHARACTER_ID,
      content: "他人の記憶",
      createdAt: 100,
    });

    const response = await app.request(
      "/api/memory-notes/note-nope",
      { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ content: "どこへ行く" }) },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(404);
    expect(readNote(db, "note-intruder")?.content).toBe("他人の記憶");
    expect(countNotes(db)).toBe(1);
  });

  it("noteId が 128 文字超なら invalid note id で 400", async () => {
    const { db, DB } = seedOwnNote();

    const response = await app.request(
      `/api/memory-notes/${"n".repeat(129)}`,
      { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ content: "長すぎるID" }) },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid note id" });
    expect(readNote(db, "note-mine")?.content).toBe("元の記憶");
  });

  it.each([
    ["content が空", { content: "" }],
    ["content が空白だけ", { content: "   " }],
    ["content が 1000 文字超", { content: "あ".repeat(1001) }],
    ["content が無い", {}],
  ])("%s なら 400 で本文は据え置き", async (_label, payload) => {
    const { db, DB } = seedOwnNote();

    const response = await app.request(
      "/api/memory-notes/note-mine",
      { method: "PATCH", headers: jsonHeaders, body: JSON.stringify(payload) },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(400);
    expect(readNote(db, "note-mine")?.content).toBe("元の記憶");
  });

  it("手編集すると edited_at が入り source_message_id が NULL になる", async () => {
    const { db, DB } = makeRealD1();
    insertNote(db, {
      id: "note-mine",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "元の記憶",
      createdAt: 100,
    });
    db.prepare("UPDATE memory_note SET source_message_id = ? WHERE id = ?").run(
      "msg-source",
      "note-mine",
    );

    const response = await app.request(
      "/api/memory-notes/note-mine",
      {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ content: "手で書き換えた記憶" }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const row = readNote(db, "note-mine");
    expect(row?.content).toBe("手で書き換えた記憶");
    expect(row?.source_message_id).toBeNull();
    expect(row?.edited_at).not.toBeNull();
  });

  it("フィルタに引っ掛かる本文は 403 で保存されん", async () => {
    const { db, DB } = seedOwnNote();

    const response = await app.request(
      "/api/memory-notes/note-mine",
      {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ content: "小学生の頃の思い出" }),
      },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "content_blocked: prohibited_minor_content",
    });
    expect(readNote(db, "note-mine")?.content).toBe("元の記憶");
  });
});

describe.skipIf(!DatabaseSyncCtor)("DELETE /api/memory-notes/:noteId", () => {
  const seedTwoOwners = () => {
    const fixture = makeRealD1();
    insertNote(fixture.db, {
      id: "note-mine",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "俺の記憶",
      createdAt: 100,
    });
    insertNote(fixture.db, {
      id: "note-mine-2",
      userId: USER_ID,
      characterId: CHARACTER_ID,
      content: "俺の記憶2",
      createdAt: 200,
    });
    insertNote(fixture.db, {
      id: "note-intruder",
      userId: OTHER_USER_ID,
      characterId: OTHER_CHARACTER_ID,
      content: "他人の記憶",
      createdAt: 300,
    });
    return fixture;
  };

  it("未認証なら 401 で、行は消えん", async () => {
    const { db, DB } = seedTwoOwners();

    const response = await app.request(
      "/api/memory-notes/note-mine",
      { method: "DELETE" },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(countNotes(db)).toBe(3);
  });

  it("自分のノートだけを消し、自分の他のノートも他人のノートも残す", async () => {
    const { db, DB } = seedTwoOwners();

    const response = await app.request(
      "/api/memory-notes/note-mine",
      { method: "DELETE", headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(readNote(db, "note-mine")).toBeUndefined();
    expect(readNote(db, "note-mine-2")?.content).toBe("俺の記憶2");
    expect(readNote(db, "note-intruder")?.content).toBe("他人の記憶");
  });

  it("他人のノート ID なら 404 で消さん", async () => {
    const { db, DB } = seedTwoOwners();

    const response = await app.request(
      "/api/memory-notes/note-intruder",
      { method: "DELETE", headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(404);
    expect(readNote(db, "note-intruder")?.content).toBe("他人の記憶");
    expect(countNotes(db)).toBe(3);
  });

  it("noteId が 128 文字超なら invalid note id で 400、行は無傷", async () => {
    const { db, DB } = seedTwoOwners();

    const response = await app.request(
      `/api/memory-notes/${"n".repeat(129)}`,
      { method: "DELETE", headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid note id" });
    expect(countNotes(db)).toBe(3);
  });
});
