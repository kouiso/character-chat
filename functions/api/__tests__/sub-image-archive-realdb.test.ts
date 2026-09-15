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

// モックではなく実SQLiteエンジンに実データを入れ、実エンドポイント経由で
// 「アーカイブ済みがレスポンスから実際に消えるか」を観測する。
// SQL文字列にフィルタが含まれることの確認（sub-image-archive-filter.test.ts）は
// クエリが「書かれている」ことしか示さず、DBが実際に行を除外する事実は示さないため。
const AUTH_TOKEN = "test-token";
const CHARACTER_ID = "char-downer";
// ensureUser は userId としてメールをそのまま返すため、所有者IDはこの値でなければ 404 になる。
const USER_EMAIL = "sukererion@gmail.com";
const USER_ID = USER_EMAIL;

const LIVE_ORDS = [22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
const ARCHIVED_ORDS = [0, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15, 16];

// drizzle の d1 ドライバが要求する D1Database 互換の窓口を実SQLiteに被せる。
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
      tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0, is_official INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE character_sub_image (
      id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, r2_key TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0, approval TEXT NOT NULL DEFAULT 'approved',
      image_model TEXT, image_provider TEXT, gen_params TEXT, archived_at INTEGER
    );
  `);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(USER_ID, USER_EMAIL);
  db.prepare("INSERT INTO character (id, user_id, name) VALUES (?, ?, ?)").run(
    CHARACTER_ID,
    USER_ID,
    "downer",
  );
  const insert = db.prepare(
    "INSERT INTO character_sub_image (character_id, r2_key, ord, archived_at) VALUES (?, ?, ?, ?)",
  );
  for (const ord of LIVE_ORDS) insert.run(CHARACTER_ID, `sub/downer/live-${ord}.jpg`, ord, null);
  for (const ord of ARCHIVED_ORDS) {
    insert.run(CHARACTER_ID, `sub/downer/old-${ord}.png`, ord, 1752000000);
  }

  const wrap = (sql: string, args: unknown[]) => {
    const isRead = /^\s*select/i.test(sql);
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const rows = () => (isRead ? (db.prepare(sql).all(...bound) as Record<string, unknown>[]) : []);
    return {
      all: () => Promise.resolve({ results: rows(), success: true }),
      first: () => Promise.resolve(rows()[0] ?? null),
      run: () => Promise.resolve({ success: true, meta: {}, results: [] }),
      raw: <T = unknown[]>() => Promise.resolve(rows().map((r) => Object.values(r)) as T[]),
    };
  };

  return {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => wrap(sql, args), ...wrap(sql, []) }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
};

describe.skipIf(!DatabaseSyncCtor)("GET /api/characters/:characterId/sub-images (実SQLite)", () => {
  it("DBの31行のうちアーカイブ済み12行を実際に除外し、19枚だけ返す", async () => {
    const DB = makeRealD1();

    // 前提: DBには31行すべて実在する（19に減るのは行が無いからではなくフィルタが効くから）。
    const all = await DB.prepare(
      `SELECT COUNT(*) AS n FROM character_sub_image WHERE character_id = '${CHARACTER_ID}'`,
    ).all();
    expect((all.results[0] as { n: number }).n).toBe(31);

    const response = await app.request(
      `/api/characters/${CHARACTER_ID}/sub-images`,
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    // response.json() は unknown を返すため、代入側で形を宣言する
    // （as だと eslint の no-unnecessary-type-assertion が外しにきて tsc と衝突する）。
    const body: { images: { r2Key: string }[] } = await response.json();
    const keys = body.images.map((i) => i.r2Key);

    expect(keys).toHaveLength(19);
    expect(keys.every((k) => k.includes("live-"))).toBe(true);
    expect(keys.some((k) => k.includes("old-"))).toBe(false);
  });
});
