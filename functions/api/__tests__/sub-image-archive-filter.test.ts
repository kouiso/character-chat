import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";

// 旧世代のサブ画像（image_meta 違反）を archived_at で本番から落とせるようにした際の回帰テスト。
// archived_at はマイグレーション 0049 で列だけ追加され、クエリ側の配線が抜けていたため
// 「印を立てても画像が出続ける」状態だった。その再発を防ぐ。
const AUTH_TOKEN = "test-token";
const CHARACTER_ID = "character-1";

type CapturedBind = { sql: string; args: unknown[] };

const makeD1Mock = () => {
  const capturedBinds: CapturedBind[] = [];

  const rowsForSql = (sql: string): Record<string, unknown>[] => {
    if (sql.includes('from "user"')) return [{ id: "user-1", email: "local@example.com" }];
    if (sql.includes('from "character"')) return [{ id: CHARACTER_ID }];
    if (sql.includes('from "character_sub_image"')) {
      return [{ r2Key: "sub/import-charap-downer/live.jpg", ord: 22 }];
    }
    return [];
  };

  return {
    capturedBinds,
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        capturedBinds.push({ sql, args });
        const queryRows = rowsForSql(sql);
        return {
          run: () => Promise.resolve({ success: true, meta: {}, results: [] }),
          all: () => Promise.resolve({ results: queryRows, success: true }),
          first: () => Promise.resolve(queryRows[0] ?? null),
          raw: <T = unknown[]>() => Promise.resolve(queryRows.map((r) => Object.values(r)) as T[]),
        };
      },
    }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
};

const subImageSelects = (binds: CapturedBind[]) =>
  binds.filter(({ sql }) => sql.includes('from "character_sub_image"') && sql.includes("select"));

describe("GET /api/characters/:characterId/sub-images", () => {
  it("アーカイブ済みサブ画像を除外するSQLを発行する", async () => {
    const db = makeD1Mock();
    const response = await app.request(
      `/api/characters/${CHARACTER_ID}/sub-images`,
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
      { AUTH_TOKEN, DB: db },
    );

    expect(response.status).toBe(200);

    const selects = subImageSelects(db.capturedBinds);
    expect(selects.length).toBeGreaterThan(0);
    // 列が存在するだけでは意味がなく、WHERE に入って初めてユーザーの目から消える。
    for (const { sql } of selects) {
      expect(sql).toContain("archived_at");
      expect(sql.replace(/\s+/g, " ")).toMatch(/"archived_at" is null/i);
    }
  });
});
