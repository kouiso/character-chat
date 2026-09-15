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

// 敵対レビュー #1236 指摘（6巡目）: PUT /api/characters/:characterId は { ok: true } だけを
// 返しており、クライアント（use-character-query.ts）は自分が送った生の入力をそのまま
// キャッシュへ書いていた。userPersonaName はサーバ側で sanitizeUserDisplayName を通り
// 正規化されうるため、表示値と D1 の実値がリロードまで乖離する。
// モックではなく実SQLiteエンジンに実データを入れ、実エンドポイント経由で
// レスポンスの updates が正規化後の値になっていることを観測する
// （sub-image-archive-realdb.test.ts と同じパターン）。
const AUTH_TOKEN = "test-token";
const CHARACTER_ID = "char-1";
// getUserEmail は Bearer が AUTH_TOKEN と一致する時 LOCAL_USER_EMAIL を返す
// （functions/api/lib/route-context.ts の LOCAL_USER_EMAIL 参照）。所有者IDはこの値。
const USER_ID = "sukererion@gmail.com";

const makeRealD1 = () => {
  if (!DatabaseSyncCtor) {
    throw new Error("node:sqlite is not available");
  }
  const db = new DatabaseSyncCtor(":memory:");
  db.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0,
      display_name TEXT
    );
    CREATE TABLE character (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT,
      gender TEXT,
      system_prompt TEXT NOT NULL DEFAULT '', greeting TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0, is_official INTEGER NOT NULL DEFAULT 0,
      slug TEXT UNIQUE, user_persona_name TEXT, user_persona_gender TEXT,
      user_persona_personality TEXT
    );
  `);
  db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(USER_ID, USER_ID);
  db.prepare("INSERT INTO character (id, user_id, name, slug) VALUES (?, ?, ?, ?)").run(
    CHARACTER_ID,
    USER_ID,
    "テストキャラ",
    "test-char",
  );

  // drizzle の d1 ドライバが要求する D1Database 互換の窓口を実SQLiteに被せる。
  const wrap = (sql: string, args: unknown[]) => {
    const isRead = /^\s*select/i.test(sql);
    const bound = args.map((a) => (a === undefined ? null : a)) as never[];
    const rows = () => (isRead ? (db.prepare(sql).all(...bound) as Record<string, unknown>[]) : []);
    return {
      all: () => Promise.resolve({ results: rows(), success: true }),
      first: () => Promise.resolve(rows()[0] ?? null),
      run: () => {
        // 書き込み文はここで実際にSQLiteへ反映する（onConflictDoNothing含む）。
        if (!isRead) db.prepare(sql).run(...bound);
        return Promise.resolve({ success: true, meta: {}, results: [] });
      },
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

describe.skipIf(!DatabaseSyncCtor)(
  "PUT /api/characters/:characterId — レスポンスで正規化後の値を返す（実SQLite）",
  () => {
    it("userPersonaNameに「」等の不安全文字が含まれていても、レスポンスのupdatesは正規化済みの値になる", async () => {
      const DB = makeRealD1();

      const response = await app.request(
        `/api/characters/${CHARACTER_ID}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${AUTH_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userPersona: { name: "太郎「」" },
          }),
        },
        { AUTH_TOKEN, DB },
      );

      expect(response.status).toBe(200);
      const body: { ok: boolean; updates?: { userPersonaName?: string | null } } =
        await response.json();
      expect(body.ok).toBe(true);
      // クライアントが送った生の値（"太郎「」"）ではなく、sanitizeUserDisplayName後の値
      expect(body.updates?.userPersonaName).toBe("太郎");
    });
  },
);
