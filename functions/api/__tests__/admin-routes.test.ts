import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";
import { LOCAL_USER_EMAIL } from "../lib/route-context";

const AUTH_TOKEN = "test-token";

type PreparedStatementCall = {
  sql: string;
  binds: unknown[];
};

const makeD1Mock = () => {
  const calls: PreparedStatementCall[] = [];

  return {
    calls,
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        return {
          run: () => Promise.resolve({ success: true, meta: {} }),
          all: <T = unknown>() => Promise.resolve({ results: [] as T[], success: true }),
          first: <T = unknown>() => Promise.resolve(null as T | null),
          raw: <T = unknown[]>() => Promise.resolve([] as T),
        };
      },
    }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
};

// r2Key・verdict が無検証のまま D1 insert の主キーに入っていたため、不正な body が
// 500 + Slack 誤アラートを引き起こしていた（zValidator 導入前の回帰防止）。
describe("PUT /api/admin/rating", () => {
  it("returns 401 without auth", async () => {
    const response = await app.request(
      "/api/admin/rating",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ r2Key: "review/x.png", verdict: "nuketa" }),
      },
      { AUTH_TOKEN, DB: makeD1Mock() },
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for an invalid verdict", async () => {
    const response = await app.request(
      "/api/admin/rating",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ r2Key: "review/x.png", verdict: "not-a-real-verdict" }),
      },
      { AUTH_TOKEN, DB: makeD1Mock() },
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when r2Key is missing", async () => {
    const response = await app.request(
      "/api/admin/rating",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ verdict: "nuketa" }),
      },
      { AUTH_TOKEN, DB: makeD1Mock() },
    );
    expect(response.status).toBe(400);
  });

  it("upserts the rating and returns ok for a valid body", async () => {
    const db = makeD1Mock();
    const response = await app.request(
      "/api/admin/rating",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ r2Key: "review/x.png", verdict: "nuketa", note: "good" }),
      },
      { AUTH_TOKEN, DB: db },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // 200 {ok:true} だけを見とると、verdict を握り潰して別の値を保存しても気付けん。
    // 「ぬけへん」と付けた判定が D1 に何として入るかを bind 値で固定する。
    const insertCalls = db.calls.filter((call) => call.sql.startsWith("insert into"));
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].binds).toEqual([
      "review/x.png",
      "nuketa",
      "good",
      LOCAL_USER_EMAIL,
      expect.any(Number),
    ]);
    // 再判定は上書きで反映される必要がある。onConflictDoUpdate を落とすと
    // 主キー衝突で無言の no-op になるため、更新句そのものを固定する。
    expect(insertCalls[0].sql).toContain('on conflict ("review_image_rating"."r2_key") do update');
    expect(insertCalls[0].sql).toContain('"verdict" = excluded.verdict');
    expect(insertCalls[0].sql).toContain('"note" = excluded.note');
    expect(insertCalls[0].sql).toContain('"rater_email" = excluded.rater_email');
    expect(insertCalls[0].sql).toContain('"updated_at" = excluded.updated_at');
  });

  it("stores the verdict the caller sent, not a fixed one", async () => {
    const db = makeD1Mock();
    const response = await app.request(
      "/api/admin/rating",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ r2Key: "review/y.png", verdict: "dame" }),
      },
      { AUTH_TOKEN, DB: db },
    );
    expect(response.status).toBe(200);

    const insertCalls = db.calls.filter((call) => call.sql.startsWith("insert into"));
    expect(insertCalls).toHaveLength(1);
    // note 未指定は空文字で保存される（NOT NULL 列を null で埋めん）。
    expect(insertCalls[0].binds.slice(0, 3)).toEqual(["review/y.png", "dame", ""]);
  });
});

describe("POST /api/admin/dedup-delete", () => {
  it("returns 401 without auth", async () => {
    const response = await app.request(
      "/api/admin/dedup-delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewKeys: ["review/x.png"] }),
      },
      { AUTH_TOKEN, DB: makeD1Mock() },
    );
    expect(response.status).toBe(401);
  });

  it("returns 400 for an empty reviewKeys array", async () => {
    const response = await app.request(
      "/api/admin/dedup-delete",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reviewKeys: [] }),
      },
      { AUTH_TOKEN, DB: makeD1Mock() },
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when reviewKeys contains a non-string element instead of a 500", async () => {
    const response = await app.request(
      "/api/admin/dedup-delete",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reviewKeys: ["review/x.png", 42] }),
      },
      { AUTH_TOKEN, DB: makeD1Mock() },
    );
    expect(response.status).toBe(400);
  });
});
