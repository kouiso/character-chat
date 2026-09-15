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

// 既存の admin-routes.test.ts / dedup-delete-image-review.test.ts は
// PUT /rating の入力検証と dedup-delete の付け替え順序だけを見とる。
// こっちは残りのエンドポイント（review-images / review/:key / ratings /
// dedup-candidates）と、R2・D1 に実際に何が起きたかを見る。
const AUTH_TOKEN = "test-token";
// getUserEmail は Host が localhost やと無条件で運用者を返す。app.request に
// パスだけ渡すと Host が付かず「たまたま」401 になるので、本番相当の origin を
// 明示して認証境界を踏ませる。
const ORIGIN = "https://adult-ai-chat.pages.dev";
const OPERATOR_EMAIL = "sukererion@gmail.com";

// tsc は response.json() を unknown と見る一方、eslint の型情報付き解決では
// 具体型が付いて `as` が不要判定になる。他のルートテストと同じヘルパで揃える。
const readJson = async <T>(res: { json: () => Promise<unknown> }): Promise<T> =>
  (await res.json()) as T;

const authHeaders = { Authorization: `Bearer ${AUTH_TOKEN}` };
const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

type FakeObject = {
  // head() が返す httpEtag の中身。multipart は "<md5>-<n>" 形式。
  etag: string;
  // list() が etag を返さんケース（head 補完経路 U2）を再現する。
  omitListEtag?: boolean;
  size: number;
  // head() が size を返さんケース。R2 の型上 size は必須やないので防御分岐がある。
  omitHeadSize?: boolean;
  body?: string;
  contentType?: string;
};

const makeBucket = (
  objects: Record<string, FakeObject>,
  pageSize = 1000,
  // truncated やのに cursor を返さん R2（打ち切り応答）を再現する。
  dropListCursor = false,
) => {
  const store = new Map(Object.entries(objects));
  const listCalls: { prefix: string | undefined; cursor: string | undefined }[] = [];
  const headCalls: string[] = [];
  const getCalls: string[] = [];
  const deletedKeys: string[] = [];

  const bucket = {
    list: (options?: { prefix?: string; limit?: number; cursor?: string }) => {
      listCalls.push({ prefix: options?.prefix, cursor: options?.cursor });
      const keys = [...store.keys()].filter((k) => k.startsWith(options?.prefix ?? "")).sort();
      const start = options?.cursor ? Number(options.cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const end = start + page.length;
      const truncated = end < keys.length;
      return Promise.resolve({
        objects: page.map((key) => {
          const object = store.get(key)!;
          return {
            key,
            etag: object.omitListEtag ? undefined : object.etag,
            size: object.size,
          };
        }),
        truncated,
        cursor: truncated && !dropListCursor ? String(end) : undefined,
      });
    },
    head: (key: string) => {
      headCalls.push(key);
      const object = store.get(key);
      return Promise.resolve(
        object
          ? { httpEtag: `"${object.etag}"`, size: object.omitHeadSize ? undefined : object.size }
          : null,
      );
    },
    get: (key: string) => {
      getCalls.push(key);
      const object = store.get(key);
      return Promise.resolve(
        object
          ? {
              body: object.body ?? "",
              httpMetadata: object.contentType ? { contentType: object.contentType } : {},
            }
          : null,
      );
    },
    delete: (key: string) => {
      deletedKeys.push(key);
      store.delete(key);
      return Promise.resolve();
    },
  };

  return { bucket, store, listCalls, headCalls, getCalls, deletedKeys };
};

type RatingRow = {
  r2_key: string;
  verdict: string;
  note: string;
  rater_email: string;
  updated_at: number;
};

const makeRealD1 = () => {
  if (!DatabaseSyncCtor) throw new Error("node:sqlite is not available");
  const db = new DatabaseSyncCtor(":memory:");
  db.exec(`
    CREATE TABLE review_image_rating (
      id INTEGER PRIMARY KEY AUTOINCREMENT, r2_key TEXT NOT NULL UNIQUE,
      verdict TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      rater_email TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    );
    CREATE TABLE image_review (
      id INTEGER PRIMARY KEY AUTOINCREMENT, r2_key TEXT NOT NULL,
      character_id TEXT NOT NULL, label TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 1,
      intent_comment TEXT NOT NULL, ai_panel_json TEXT, director_score INTEGER,
      director_comment TEXT, verdict TEXT NOT NULL DEFAULT 'pending',
      image_model TEXT, seed INTEGER, prompt TEXT, gen_params TEXT,
      created_at INTEGER NOT NULL
    );
  `);

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

  const DB = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => wrap(sql, args), ...wrap(sql, []) }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return { db, DB };
};

const insertRating = (
  db: DatabaseSync,
  row: { r2Key: string; verdict: string; note: string; raterEmail: string; updatedAt: number },
) => {
  db.prepare(
    "INSERT INTO review_image_rating (r2_key, verdict, note, rater_email, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(row.r2Key, row.verdict, row.note, row.raterEmail, row.updatedAt);
};

const readRating = (db: DatabaseSync, r2Key: string): RatingRow | undefined =>
  db.prepare("SELECT * FROM review_image_rating WHERE r2_key = ?").get(r2Key) as
    | RatingRow
    | undefined;

const insertImageReview = (db: DatabaseSync, r2Key: string) => {
  db.prepare(
    "INSERT INTO image_review (r2_key, character_id, label, intent_comment, created_at) VALUES (?, 'char-1', 'A', 'テスト', 0)",
  ).run(r2Key);
};

const readImageReviewKeys = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT r2_key FROM image_review ORDER BY id").all() as { r2_key: string }[]).map(
    (r) => r.r2_key,
  );

const MD5_A = "d41d8cd98f00b204e9800998ecf8427e";
const MD5_B = "0cc175b9c0f1b6a831c399e269772661";
const MD5_C = "92eb5ffee6ae2fec3ad71c777531578f";

describe.skipIf(!DatabaseSyncCtor)("GET /api/admin/review-images", () => {
  it("未認証なら 401 unauthorized を返し、R2 を一切叩かん", async () => {
    const { DB } = makeRealD1();
    const { bucket, listCalls } = makeBucket({});
    const response = await app.request(
      `${ORIGIN}/api/admin/review-images`,
      {},
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(listCalls).toEqual([]);
  });

  it("review/ 配下だけを key と size で返し、末尾ページでは cursor を null にする", async () => {
    const { DB } = makeRealD1();
    const { bucket, listCalls } = makeBucket({
      "review/a.png": { etag: MD5_A, size: 10 },
      "review/b.png": { etag: MD5_B, size: 20 },
      "sub/c.png": { etag: MD5_C, size: 30 },
    });
    const response = await app.request(
      `${ORIGIN}/api/admin/review-images`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        { key: "review/a.png", size: 10 },
        { key: "review/b.png", size: 20 },
      ],
      cursor: null,
    });
    expect(listCalls).toEqual([{ prefix: "review/", cursor: undefined }]);
  });

  it("cursor クエリを R2 へ引き渡し、続きがあるときは次の cursor を返す", async () => {
    const { DB } = makeRealD1();
    const { bucket, listCalls } = makeBucket(
      {
        "review/a.png": { etag: MD5_A, size: 10 },
        "review/b.png": { etag: MD5_B, size: 20 },
        "review/c.png": { etag: MD5_C, size: 30 },
      },
      2,
    );
    const first = await app.request(
      `${ORIGIN}/api/admin/review-images`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(await first.json()).toEqual({
      items: [
        { key: "review/a.png", size: 10 },
        { key: "review/b.png", size: 20 },
      ],
      cursor: "2",
    });

    const second = await app.request(
      `${ORIGIN}/api/admin/review-images?cursor=2`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );
    expect(await second.json()).toEqual({
      items: [{ key: "review/c.png", size: 30 }],
      cursor: null,
    });
    expect(listCalls[1]).toEqual({ prefix: "review/", cursor: "2" });
  });

  it("truncated やのに R2 が cursor を返さんかったら cursor は null にする", async () => {
    const { DB } = makeRealD1();
    const { bucket } = makeBucket(
      {
        "review/a.png": { etag: MD5_A, size: 10 },
        "review/b.png": { etag: MD5_B, size: 20 },
      },
      1,
      true,
    );
    const response = await app.request(
      `${ORIGIN}/api/admin/review-images`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    await expect(response.json()).resolves.toEqual({
      items: [{ key: "review/a.png", size: 10 }],
      cursor: null,
    });
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/admin/review/:key", () => {
  const objects = {
    "review/a.png": { etag: MD5_A, size: 3, body: "png", contentType: "image/jpeg" },
    "review/no-meta.png": { etag: MD5_B, size: 3, body: "raw" },
    "sub/secret.png": { etag: MD5_C, size: 6, body: "secret" },
  };

  it("未認証なら 401 を返し、R2 の get まで到達させん", async () => {
    const { DB } = makeRealD1();
    const { bucket, getCalls } = makeBucket(objects);
    const response = await app.request(
      `${ORIGIN}/api/admin/review/review%2Fa.png`,
      {},
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(getCalls).toEqual([]);
  });

  it("review/ 以外のキーは実在しても 400 bad_key で弾き、読ません", async () => {
    const { DB } = makeRealD1();
    const { bucket, getCalls } = makeBucket(objects);
    const response = await app.request(
      `${ORIGIN}/api/admin/review/sub%2Fsecret.png`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_key" });
    expect(getCalls).toEqual([]);
  });

  it(".. を含むキーは review/ 始まりでも 400 bad_key で弾く", async () => {
    const { DB } = makeRealD1();
    const { bucket, getCalls } = makeBucket({
      ...objects,
      "review/../sub/secret.png": { etag: MD5_C, size: 6, body: "secret" },
    });
    // %2F で 1 セグメントに畳んで送らんと URL 側で .. が正規化されて消える。
    const response = await app.request(
      `${ORIGIN}/api/admin/review/review%2F..%2Fsub%2Fsecret.png`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "bad_key" });
    expect(getCalls).toEqual([]);
  });

  it("存在せんキーは 404 not_found", async () => {
    const { DB } = makeRealD1();
    const { bucket } = makeBucket(objects);
    const response = await app.request(
      `${ORIGIN}/api/admin/review/review%2Fmissing.png`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("保存された Content-Type でバイトを返す", async () => {
    const { DB } = makeRealD1();
    const { bucket, getCalls } = makeBucket(objects);
    const response = await app.request(
      `${ORIGIN}/api/admin/review/review%2Fa.png`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    await expect(response.text()).resolves.toBe("png");
    expect(getCalls).toEqual(["review/a.png"]);
  });

  it("httpMetadata に contentType が無ければ image/png へ倒す", async () => {
    const { DB } = makeRealD1();
    const { bucket } = makeBucket(objects);
    const response = await app.request(
      `${ORIGIN}/api/admin/review/review%2Fno-meta.png`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    await expect(response.text()).resolves.toBe("raw");
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/admin/ratings", () => {
  it("未認証なら 401 unauthorized", async () => {
    const { DB } = makeRealD1();
    const response = await app.request(`${ORIGIN}/api/admin/ratings`, {}, { AUTH_TOKEN, DB });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("保存済みの判定を r2Key/verdict/note/updatedAt だけに絞って返す（raterEmail は伏せる）", async () => {
    const { db, DB } = makeRealD1();
    insertRating(db, {
      r2Key: "review/a.png",
      verdict: "nuketa",
      note: "良い",
      raterEmail: OPERATOR_EMAIL,
      updatedAt: 111,
    });
    insertRating(db, {
      r2Key: "review/b.png",
      verdict: "dame",
      note: "",
      raterEmail: OPERATOR_EMAIL,
      updatedAt: 222,
    });

    const response = await app.request(
      `${ORIGIN}/api/admin/ratings`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    const body = await readJson<Record<string, unknown>[]>(response);
    expect(body).toEqual([
      { r2Key: "review/a.png", verdict: "nuketa", note: "良い", updatedAt: 111 },
      { r2Key: "review/b.png", verdict: "dame", note: "", updatedAt: 222 },
    ]);
    expect(Object.keys(body[0])).not.toContain("raterEmail");
  });

  it("判定が 0 件なら空配列", async () => {
    const { DB } = makeRealD1();
    const response = await app.request(
      `${ORIGIN}/api/admin/ratings`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });
});

describe.skipIf(!DatabaseSyncCtor)("PUT /api/admin/rating", () => {
  const putRating = (body: unknown, DB: unknown, headers: Record<string, string> = jsonHeaders) =>
    app.request(
      `${ORIGIN}/api/admin/rating`,
      { method: "PUT", headers, body: JSON.stringify(body) },
      { AUTH_TOKEN, DB },
    );

  it("未認証なら 401 で、行を1つも書かん", async () => {
    const { db, DB } = makeRealD1();
    const response = await putRating({ r2Key: "review/a.png", verdict: "nuketa" }, DB, {
      "Content-Type": "application/json",
    });

    expect(response.status).toBe(401);
    expect(readRating(db, "review/a.png")).toBeUndefined();
  });

  it("行を実際に upsert し、note 未指定は空文字、rater は解決済みの運用者になる", async () => {
    const { db, DB } = makeRealD1();
    const response = await putRating({ r2Key: "review/a.png", verdict: "microm" }, DB);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const row = readRating(db, "review/a.png");
    expect(row?.verdict).toBe("microm");
    expect(row?.note).toBe("");
    expect(row?.rater_email).toBe(OPERATOR_EMAIL);
    expect(row?.updated_at).toBeGreaterThan(0);
  });

  it("同じ r2Key を再送すると行が増えず verdict と note が上書きされる", async () => {
    const { db, DB } = makeRealD1();
    insertRating(db, {
      r2Key: "review/a.png",
      verdict: "dame",
      note: "旧",
      raterEmail: "old@example.com",
      updatedAt: 1,
    });

    const response = await putRating({ r2Key: "review/a.png", verdict: "nuketa", note: "新" }, DB);

    expect(response.status).toBe(200);
    const count = db.prepare("SELECT COUNT(*) AS n FROM review_image_rating").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
    const row = readRating(db, "review/a.png");
    expect(row?.verdict).toBe("nuketa");
    expect(row?.note).toBe("新");
    expect(row?.rater_email).toBe(OPERATOR_EMAIL);
    expect(row?.updated_at).toBeGreaterThan(1);
  });

  it("r2Key が 500 文字超なら 400 で書き込まん", async () => {
    const { db, DB } = makeRealD1();
    const longKey = `review/${"a".repeat(500)}`;
    const response = await putRating({ r2Key: longKey, verdict: "nuketa" }, DB);

    expect(response.status).toBe(400);
    expect(readRating(db, longKey)).toBeUndefined();
  });

  it("note が 2000 文字超なら 400 で書き込まん", async () => {
    const { db, DB } = makeRealD1();
    const response = await putRating(
      { r2Key: "review/a.png", verdict: "nuketa", note: "あ".repeat(2001) },
      DB,
    );

    expect(response.status).toBe(400);
    expect(readRating(db, "review/a.png")).toBeUndefined();
  });

  it("r2Key が空文字なら 400", async () => {
    const { DB } = makeRealD1();
    const response = await putRating({ r2Key: "", verdict: "nuketa" }, DB);

    expect(response.status).toBe(400);
  });
});

describe.skipIf(!DatabaseSyncCtor)("GET /api/admin/dedup-candidates", () => {
  it("未認証なら 401 で、R2 の走査を始めん", async () => {
    const { DB } = makeRealD1();
    const { bucket, listCalls } = makeBucket({});
    const response = await app.request(
      `${ORIGIN}/api/admin/dedup-candidates`,
      {},
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(listCalls).toEqual([]);
  });

  it("etag が sub/ と完全一致する review/ キーだけを候補に返す", async () => {
    const { DB } = makeRealD1();
    const { bucket } = makeBucket({
      "review/dup.png": { etag: MD5_A, size: 100 },
      "review/uniq.png": { etag: MD5_B, size: 200 },
      "sub/dup.png": { etag: MD5_A, size: 100 },
    });
    const response = await app.request(
      `${ORIGIN}/api/admin/dedup-candidates`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      candidates: [{ reviewKey: "review/dup.png", subKey: "sub/dup.png", size: 100 }],
    });
  });

  it("候補0件なら note を添えて返す", async () => {
    const { DB } = makeRealD1();
    const { bucket } = makeBucket({
      "review/a.png": { etag: MD5_A, size: 10 },
      "sub/b.png": { etag: MD5_B, size: 10 },
    });
    const response = await app.request(
      `${ORIGIN}/api/admin/dedup-candidates`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      candidates: [],
      note: "候補0件 — sub/ 採用が再エンコードを挟む場合は MD5 不一致になり候補が出ません (U1)",
    });
  });

  it("multipart etag（ハイフン付き）は review 側も sub 側も候補にせん", async () => {
    const { DB } = makeRealD1();
    const { bucket } = makeBucket({
      "review/multi.png": { etag: `${MD5_A}-2`, size: 10 },
      "sub/multi.png": { etag: `${MD5_A}-2`, size: 10 },
      "review/plain.png": { etag: MD5_B, size: 10 },
      "sub/plain-multi.png": { etag: `${MD5_B}-3`, size: 10 },
    });
    const response = await app.request(
      `${ORIGIN}/api/admin/dedup-candidates`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    const body = await readJson<{ candidates: unknown[] }>(response);
    expect(body.candidates).toEqual([]);
  });

  it("list が etag を返さん sub/ オブジェクトは head で補完して一致を拾う", async () => {
    const { DB } = makeRealD1();
    const { bucket, headCalls } = makeBucket({
      "review/dup.png": { etag: MD5_A, size: 100 },
      "sub/dup.png": { etag: MD5_A, size: 100, omitListEtag: true },
    });
    const response = await app.request(
      `${ORIGIN}/api/admin/dedup-candidates`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(headCalls).toEqual(["sub/dup.png"]);
    await expect(response.json()).resolves.toEqual({
      candidates: [{ reviewKey: "review/dup.png", subKey: "sub/dup.png", size: 100 }],
    });
  });

  it("head 補完しても multipart etag なら候補にせん", async () => {
    const { DB } = makeRealD1();
    const { bucket, headCalls } = makeBucket({
      "review/dup.png": { etag: MD5_A, size: 100 },
      "sub/dup.png": { etag: `${MD5_A}-4`, size: 100, omitListEtag: true },
    });
    const response = await app.request(
      `${ORIGIN}/api/admin/dedup-candidates`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    expect(headCalls).toEqual(["sub/dup.png"]);
    const body = await readJson<{ candidates: unknown[] }>(response);
    expect(body.candidates).toEqual([]);
  });

  it("sub/ と review/ が複数ページに割れても cursor を追って全件突き合わせる", async () => {
    const { DB } = makeRealD1();
    const { bucket, listCalls } = makeBucket(
      {
        "review/a.png": { etag: MD5_A, size: 10 },
        "review/b.png": { etag: MD5_B, size: 20 },
        "review/c.png": { etag: MD5_C, size: 30 },
        "sub/a.png": { etag: MD5_A, size: 10 },
        "sub/c.png": { etag: MD5_C, size: 30 },
      },
      1,
    );
    const response = await app.request(
      `${ORIGIN}/api/admin/dedup-candidates`,
      { headers: authHeaders },
      { AUTH_TOKEN, DB, BUCKET: bucket },
    );

    await expect(response.json()).resolves.toEqual({
      candidates: [
        { reviewKey: "review/a.png", subKey: "sub/a.png", size: 10 },
        { reviewKey: "review/c.png", subKey: "sub/c.png", size: 30 },
      ],
    });
    // 1件ずつしか返さん R2 でも sub/ 2ページ+終端、review/ 3ページ+終端を辿る。
    expect(listCalls.filter((c) => c.prefix === "sub/").length).toBeGreaterThan(1);
    expect(listCalls.filter((c) => c.prefix === "review/").length).toBeGreaterThan(1);
  });
});

describe.skipIf(!DatabaseSyncCtor)("POST /api/admin/dedup-delete", () => {
  const postDelete = (
    body: unknown,
    env: Record<string, unknown>,
    headers: Record<string, string> = jsonHeaders,
  ) =>
    app.request(
      `${ORIGIN}/api/admin/dedup-delete`,
      { method: "POST", headers, body: JSON.stringify(body) },
      { AUTH_TOKEN, ...env },
    );

  it("未認証なら 401 で、head も delete も呼ばん", async () => {
    const { DB } = makeRealD1();
    const { bucket, headCalls, deletedKeys } = makeBucket({
      "review/dup.png": { etag: MD5_A, size: 100 },
      "sub/dup.png": { etag: MD5_A, size: 100 },
    });
    const response = await postDelete(
      { reviewKeys: ["review/dup.png"] },
      { DB, BUCKET: bucket },
      { "Content-Type": "application/json" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(headCalls).toEqual([]);
    expect(deletedKeys).toEqual([]);
  });

  it("一致した review/ を消し、判定と審査レコードを sub/ 側へ付け替える", async () => {
    const { db, DB } = makeRealD1();
    insertImageReview(db, "review/dup.png");
    const { bucket, deletedKeys, store } = makeBucket({
      "review/dup.png": { etag: MD5_A, size: 100 },
      "sub/dup.png": { etag: MD5_A, size: 100 },
    });

    const response = await postDelete({ reviewKeys: ["review/dup.png"] }, { DB, BUCKET: bucket });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedCount: 1, freedBytes: 100 });
    expect(deletedKeys).toEqual(["review/dup.png"]);
    expect(store.has("review/dup.png")).toBe(false);
    expect(store.has("sub/dup.png")).toBe(true);
    expect(readImageReviewKeys(db)).toEqual(["sub/dup.png"]);
    const rating = readRating(db, "sub/dup.png");
    expect(rating?.verdict).toBe("nuketa");
    expect(rating?.note).toBe("(review/ から移行: review/dup.png)");
    expect(rating?.rater_email).toBe(OPERATOR_EMAIL);
  });

  it("sub/ に同一 etag が無ければ削除せず 0 件で返す", async () => {
    const { db, DB } = makeRealD1();
    insertImageReview(db, "review/only.png");
    const { bucket, deletedKeys } = makeBucket({
      "review/only.png": { etag: MD5_A, size: 100 },
      "sub/other.png": { etag: MD5_B, size: 100 },
    });

    const response = await postDelete({ reviewKeys: ["review/only.png"] }, { DB, BUCKET: bucket });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedCount: 0, freedBytes: 0 });
    expect(deletedKeys).toEqual([]);
    expect(readImageReviewKeys(db)).toEqual(["review/only.png"]);
  });

  it("review/ 以外と .. 入りのキーは head すら引かず、sub/ の実体も消さん", async () => {
    const { DB } = makeRealD1();
    const { bucket, headCalls, deletedKeys, listCalls } = makeBucket({
      "sub/dup.png": { etag: MD5_A, size: 100 },
      "review/../sub/dup.png": { etag: MD5_A, size: 100 },
    });

    const response = await postDelete(
      { reviewKeys: ["sub/dup.png", "review/../sub/dup.png"] },
      { DB, BUCKET: bucket },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deletedCount: 0, freedBytes: 0 });
    expect(headCalls).toEqual([]);
    expect(deletedKeys).toEqual([]);
    // 有効キーが1件も無い時点で打ち切り、sub/ の全件走査へ入らん。
    expect(listCalls).toEqual([]);
  });

  it("R2 に存在せんキーは head が null なので何も消さん", async () => {
    const { DB } = makeRealD1();
    const { bucket, headCalls, deletedKeys, listCalls } = makeBucket({
      "sub/dup.png": { etag: MD5_A, size: 100 },
    });

    const response = await postDelete({ reviewKeys: ["review/ghost.png"] }, { DB, BUCKET: bucket });

    await expect(response.json()).resolves.toEqual({ deletedCount: 0, freedBytes: 0 });
    expect(headCalls).toEqual(["review/ghost.png"]);
    expect(deletedKeys).toEqual([]);
    expect(listCalls).toEqual([]);
  });

  it("multipart etag の review/ は同一性を確かめられんので消さん", async () => {
    const { DB } = makeRealD1();
    const { bucket, deletedKeys } = makeBucket({
      "review/multi.png": { etag: `${MD5_A}-2`, size: 100 },
      "sub/dup.png": { etag: MD5_A, size: 100 },
    });

    const response = await postDelete({ reviewKeys: ["review/multi.png"] }, { DB, BUCKET: bucket });

    await expect(response.json()).resolves.toEqual({ deletedCount: 0, freedBytes: 0 });
    expect(deletedKeys).toEqual([]);
  });

  it("複数キーのうち一致した分だけ消し、freedBytes を合算する", async () => {
    const { db, DB } = makeRealD1();
    insertImageReview(db, "review/dup1.png");
    insertImageReview(db, "review/dup2.png");
    insertImageReview(db, "review/keep.png");
    const { bucket, deletedKeys } = makeBucket({
      "review/dup1.png": { etag: MD5_A, size: 100 },
      "review/dup2.png": { etag: MD5_B, size: 250 },
      "review/keep.png": { etag: MD5_C, size: 999 },
      "sub/dup1.png": { etag: MD5_A, size: 100 },
      "sub/dup2.png": { etag: MD5_B, size: 250 },
    });

    const response = await postDelete(
      { reviewKeys: ["review/dup1.png", "review/dup2.png", "review/keep.png"] },
      { DB, BUCKET: bucket },
    );

    await expect(response.json()).resolves.toEqual({ deletedCount: 2, freedBytes: 350 });
    expect([...deletedKeys].sort()).toEqual(["review/dup1.png", "review/dup2.png"]);
    expect(readImageReviewKeys(db)).toEqual(["sub/dup1.png", "sub/dup2.png", "review/keep.png"]);
  });

  it("head が size を返さんかったら freedBytes を 0 として数える", async () => {
    const { DB } = makeRealD1();
    const { bucket, deletedKeys } = makeBucket({
      "review/dup.png": { etag: MD5_A, size: 100, omitHeadSize: true },
      "sub/dup.png": { etag: MD5_A, size: 100 },
    });

    const response = await postDelete({ reviewKeys: ["review/dup.png"] }, { DB, BUCKET: bucket });

    await expect(response.json()).resolves.toEqual({ deletedCount: 1, freedBytes: 0 });
    expect(deletedKeys).toEqual(["review/dup.png"]);
  });

  it("同じ sub/ キーへ二度目の移行が来ても判定行は増えず note だけ更新される", async () => {
    const { db, DB } = makeRealD1();
    insertRating(db, {
      r2Key: "sub/dup.png",
      verdict: "dame",
      note: "旧",
      raterEmail: "old@example.com",
      updatedAt: 1,
    });
    const { bucket } = makeBucket({
      "review/dup.png": { etag: MD5_A, size: 100 },
      "sub/dup.png": { etag: MD5_A, size: 100 },
    });

    const response = await postDelete({ reviewKeys: ["review/dup.png"] }, { DB, BUCKET: bucket });

    expect(response.status).toBe(200);
    const count = db.prepare("SELECT COUNT(*) AS n FROM review_image_rating").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
    const row = readRating(db, "sub/dup.png");
    expect(row?.note).toBe("(review/ から移行: review/dup.png)");
    // onConflictDoUpdate が verdict を set 対象にしとらんので、既存の "dame" が残る。
    expect(row?.verdict).toBe("dame");
  });
});
