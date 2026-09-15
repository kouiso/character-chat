import { describe, expect, it } from "vitest";

import { app, getUserEmail } from "../[[route]]";

// 本番の画像非表示バグの回帰テスト。
// 原因1: 同一オリジンの <img> サブリクエストは Bearer を付与できず、cookie が無い
//        native Basic セッションでは本人を解決できなかった。現在は basic 認証のみ方針で
//        getUserEmail 自体が Basic セッションを単一運用者として解決する。
// 原因2: /api/avatar の sub/ 所有権チェックが key のパスセグメントを character.id と
//        みなしていたが、実際の対応は character_sub_image.r2_key → character_id。
const BASIC_USER = "operator";
const BASIC_PASS = "s3cret-pass";
const basicHeader = () => `Basic ${btoa(`${BASIC_USER}:${BASIC_PASS}`)}`;

const authEnv = {
  AUTH_TOKEN: "test-token",
  BASIC_AUTH_USER: BASIC_USER,
  BASIC_AUTH_PASS: BASIC_PASS,
};

describe("getUserEmail は basic 認証セッションを単一運用者として解決する（basic 認証のみ方針）", () => {
  it("Basic ヘッダ単体で単一運用者を返す", async () => {
    const headers: Record<string, string> = { Authorization: basicHeader() };
    const ctx = {
      req: { header: (key: string): string | undefined => headers[key] },
      env: authEnv as never,
    };
    await expect(getUserEmail(ctx)).resolves.toBe("sukererion@gmail.com");
  });
});

// drizzle-orm/d1 の select を prepare(sql).bind(...).values()/raw() へ落とすモック。
type Fixtures = {
  message: Array<{ image_key: string; user_id: string }>;
  character_sub_image: Array<{ r2_key: string; character_id: string }>;
  character: Array<{ id: string; user_id: string }>;
};

const makeDrizzleD1Mock = (fx: Fixtures) => ({
  prepare: (sql: string) => ({
    bind: (...binds: unknown[]) => {
      const compute = (): unknown[][] => {
        const table = sql.match(/from "([_a-z]+)"/)?.[1];
        if (table === "message") {
          const [key, uid] = binds;
          return fx.message
            .filter((r) => r.image_key === key && r.user_id === uid)
            .map(() => ["m1"]);
        }
        if (table === "character_sub_image") {
          const [key] = binds;
          return fx.character_sub_image
            .filter((r) => r.r2_key === key)
            .map((r) => [r.character_id]);
        }
        if (table === "character") {
          // このテストで character への所有権クエリは常に (id, user_id) 束縛。
          const [cid, uid] = binds;
          return fx.character.filter((r) => r.id === cid && r.user_id === uid).map(() => ["c1"]);
        }
        return [];
      };
      return {
        run: () => Promise.resolve({ success: true, meta: {} }),
        raw: <T = unknown[]>() => Promise.resolve(compute() as T[]),
        values: <T = unknown[]>() => Promise.resolve(compute() as T[]),
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
    Promise.resolve({ body: "binary-image-bytes", httpMetadata: { contentType: "image/png" } }),
});

const requestWithBasic = (path: string, fx: Fixtures) =>
  app.request(
    path,
    { headers: { Authorization: basicHeader() } },
    { ...authEnv, DB: makeDrizzleD1Mock(fx), BUCKET: makeBucketMock() },
  );

const CHAT_KEY = "images/11111111-1111-1111-1111-111111111111.jpg";
// パスセグメント "char-koharu" は character.id ("default-character" 等) と一致しない実データ形。
const SUB_KEY = "sub/char-koharu/sakura-jiigo-sweat.png";
const OPERATOR = "sukererion@gmail.com";

describe("画像/アバター配信を Basic セッションの <img> サブリクエストで解決する", () => {
  it("/api/image/r2 は Basic セッションだけで所有画像を 200 で返す（原因1）", async () => {
    const fx: Fixtures = {
      message: [{ image_key: CHAT_KEY, user_id: OPERATOR }],
      character_sub_image: [],
      character: [],
    };
    const res = await requestWithBasic(`/api/image/r2/${CHAT_KEY}`, fx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("/api/avatar の sub/ はセグメント≠character.id でも character_sub_image で所有解決し 200（原因1+2）", async () => {
    const fx: Fixtures = {
      message: [],
      character_sub_image: [{ r2_key: SUB_KEY, character_id: "default-character" }],
      character: [{ id: "default-character", user_id: OPERATOR }],
    };
    const res = await requestWithBasic(`/api/avatar/${SUB_KEY}`, fx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("/api/avatar の sub/ は非所有者には 404（IDOR を作らない）", async () => {
    const fx: Fixtures = {
      message: [],
      character_sub_image: [{ r2_key: SUB_KEY, character_id: "default-character" }],
      character: [{ id: "default-character", user_id: "someone-else@example.com" }],
    };
    const res = await requestWithBasic(`/api/avatar/${SUB_KEY}`, fx);
    expect(res.status).toBe(404);
  });
});
