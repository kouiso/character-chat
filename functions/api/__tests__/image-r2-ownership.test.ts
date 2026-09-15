import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";

// /api/image/r2/:key の IDOR 防止（所有者チェック）を検証する。
// 所有判定は message / group_message / character_sub_image を横断する。

type Fixtures = {
  message: Array<{ image_key: string; user_id: string }>;
  group_message: Array<{ image_key: string; user_id: string }>;
  character_sub_image: Array<{ r2_key: string; character_id: string }>;
  character: Array<{ id: string; user_id: string }>;
};

const emptyFixtures = (): Fixtures => ({
  message: [],
  group_message: [],
  character_sub_image: [],
  character: [],
});

// drizzle-orm/d1 は select を prepare(sql).bind(...).all() に落とす。
// SQL の `from "<table>"` でテーブルを判別し、bind 値で絞り込んだ行を返す。
const makeDrizzleD1Mock = (fx: Fixtures) => ({
  prepare: (sql: string) => ({
    bind: (...binds: unknown[]) => {
      // drizzle は select({...}) を values()→raw()（列順の配列）に落とす。
      const computeRows = (): unknown[][] => {
        const table = sql.match(/from "([_a-z]+)"/)?.[1];
        if (table === "message") {
          const [key, uid] = binds;
          return fx.message
            .filter((r) => r.image_key === key && r.user_id === uid)
            .map(() => ["m1"]);
        }
        if (table === "group_message") {
          const [key, uid] = binds;
          return fx.group_message
            .filter((r) => r.image_key === key && r.user_id === uid)
            .map(() => ["g1"]);
        }
        if (table === "character_sub_image") {
          const [key] = binds;
          return fx.character_sub_image
            .filter((r) => r.r2_key === key)
            .map((r) => [r.character_id]);
        }
        if (table === "character") {
          const [cid, uid] = binds;
          return fx.character.filter((r) => r.id === cid && r.user_id === uid).map(() => ["c1"]);
        }
        return [];
      };
      return {
        run: () => Promise.resolve({ success: true, meta: {} }),
        raw: <T = unknown[]>() => Promise.resolve(computeRows() as T[]),
        values: <T = unknown[]>() => Promise.resolve(computeRows() as T[]),
        all: <T = unknown>() => Promise.resolve({ results: [] as T[], success: true }),
        first: <T = unknown>() => Promise.resolve(null as T | null),
      };
    },
  }),
  dump: () => Promise.resolve(new ArrayBuffer(0)),
  batch: () => Promise.resolve([]),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
});

const makeBucketMock = () => ({
  get: () =>
    Promise.resolve({
      body: "binary-image-bytes",
      httpMetadata: { contentType: "image/jpeg" },
    }),
});

const requestImage = async (fx: Fixtures, _email: string, key: string) =>
  app.request(
    `/api/image/r2/${key}`,
    { headers: { Authorization: "Bearer test-token" } },
    {
      AUTH_TOKEN: "test-token",
      DB: makeDrizzleD1Mock(fx),
      BUCKET: makeBucketMock(),
      OPENROUTER_API_KEY: "",
      NOVITA_API_KEY: "",
    },
  );

const OWNED_KEY = "images/11111111-1111-1111-1111-111111111111.jpg";

describe("GET /api/image/r2/:key ownership (IDOR)", () => {
  it("returns 200 for an image owned via the user's message", async () => {
    const fx = emptyFixtures();
    fx.message.push({ image_key: OWNED_KEY, user_id: "sukererion@gmail.com" });
    const res = await requestImage(fx, "sukererion@gmail.com", OWNED_KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("returns 404 when another user requests an image they do not own", async () => {
    const fx = emptyFixtures();
    fx.message.push({ image_key: OWNED_KEY, user_id: "other@example.com" });
    const res = await requestImage(fx, "sukererion@gmail.com", OWNED_KEY);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a well-formed key that exists for nobody", async () => {
    const res = await requestImage(emptyFixtures(), "sukererion@gmail.com", OWNED_KEY);
    expect(res.status).toBe(404);
  });

  it("rejects malformed keys with 400 before any ownership lookup", async () => {
    const res = await requestImage(emptyFixtures(), "sukererion@gmail.com", "images/not-a-key");
    expect(res.status).toBe(400);
  });
});
