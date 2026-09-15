import { describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

const AUTH_TOKEN = "test-token";
type MockRow = Record<string, unknown>;

// drizzle-orm D1 セッションが呼ぶ prepare → bind → run/all/raw を最低限実装したモック
// SELECT クエリは values() → raw() の経路を通るため raw も必要。
const makeD1Mock = (characterRowsByQuery: MockRow[][] = [[{ id: "char-1" }]]) => {
  let characterQueryIndex = 0;
  return {
    prepare: (sql: string) => ({
      bind: () => {
        const queryRows = sql.includes('from "character"')
          ? (characterRowsByQuery[characterQueryIndex++] ?? [])
          : [];
        return {
          run: () => Promise.resolve({ success: true, meta: {} }),
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

const requestAvatar = (
  key: string,
  options?: {
    auth?: boolean;
    object?: unknown;
    objectsByKey?: Record<string, unknown>;
    characterRowsByQuery?: MockRow[][];
    // パス (/avatars/<key>) → 同梱アセットの応答。未登録パスは 404 を返す。
    bundledAssets?: Record<string, { body: string; contentType: string }>;
  },
) => {
  const headers: Record<string, string> = {};
  if (options?.auth) {
    headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  }
  const get = vi.fn((objectKey: string) =>
    Promise.resolve(options?.objectsByKey?.[objectKey] ?? options?.object ?? null),
  );

  const assetFetch = vi.fn((input: Request | string | URL) => {
    const pathname = decodeURIComponent(new URL(String(input)).pathname);
    const asset = options?.bundledAssets?.[pathname];
    if (!asset) return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(
      new Response(asset.body, { status: 200, headers: { "Content-Type": asset.contentType } }),
    );
  });

  return {
    get,
    assetFetch,
    response: app.request(
      `/api/avatar/${key}`,
      { headers },
      {
        AUTH_TOKEN,
        DB: makeD1Mock(options?.characterRowsByQuery ?? [[], [{ id: "private-char" }]]),
        BUCKET: {
          get,
        },
        ASSETS: { fetch: assetFetch },
      },
    ),
  };
};

describe("GET /api/avatar/:key", () => {
  it("serves an official avatar without auth for browser img tags", async () => {
    const { get, response: responsePromise } = requestAvatar("official/alice.webp", {
      object: { body: "official-webp-bytes" },
      characterRowsByQuery: [[{ id: "official-char" }]],
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(await response.text()).toBe("official-webp-bytes");
    expect(get).toHaveBeenCalledWith("official/alice.webp");
  });

  it("falls back to the legacy avatars prefix when the root official object is only a placeholder", async () => {
    const { get, response: responsePromise } = requestAvatar("official/alice.webp", {
      objectsByKey: {
        "official/alice.webp": { body: "x", size: 1 },
        "avatars/official/alice.webp": { body: "official-webp-bytes", size: 19 },
      },
      characterRowsByQuery: [[{ id: "official-char" }]],
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("official-webp-bytes");
    expect(get).toHaveBeenNthCalledWith(1, "official/alice.webp");
    expect(get).toHaveBeenNthCalledWith(2, "avatars/official/alice.webp");
  });

  it("returns 404 when a private avatar R2 object is missing", async () => {
    const { get, response: responsePromise } = requestAvatar("alice.png", { auth: true });
    const response = await responsePromise;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(get).toHaveBeenCalledWith("avatars/alice.png");
  });

  it("serves a private avatar to its owner with private cache headers", async () => {
    const { get, response: responsePromise } = requestAvatar("alice.webp", {
      auth: true,
      object: {
        body: "webp-bytes",
      },
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400, must-revalidate");
    expect(await response.text()).toBe("webp-bytes");
    expect(get).toHaveBeenCalledWith("avatars/alice.webp");
  });

  // character.avatar は本人が任意の文字列を書けるので、そこへ別名前空間のキーを入れると
  // 所有権チェックを自分で満たせてまう。getAvatarObject の素キーフォールバックと合わさると
  // `avatars/` の外が読める経路になるため、プライベート側のキー形を制限しとる。
  it("refuses a foreign-namespace key even when the caller owns a character row matching it", async () => {
    for (const key of [
      "images/00000000-0000-0000-0000-000000000000.png",
      "review/secret.png",
      "image-gen-task/task-1.json",
      "avatars/alice.webp",
    ]) {
      const { get, response: responsePromise } = requestAvatar(key, {
        auth: true,
        object: { body: "victim-bytes" },
        // 1件目=公式判定(空), 2件目=avatar カラム一致(ヒットさせる)
        characterRowsByQuery: [[], [{ id: "attacker-char" }]],
      });
      const response = await responsePromise;

      expect(response.status, key).toBe(404);
      expect(get, key).not.toHaveBeenCalled();
    }
  });

  it("returns 404 when a non-owner requests a private non-official avatar", async () => {
    const { get, response: responsePromise } = requestAvatar("alice-notmine.webp", {
      auth: true,
      object: { body: "private-webp-bytes" },
      characterRowsByQuery: [[], []],
    });
    const response = await responsePromise;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(get).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated private avatar requests", async () => {
    const { get, response: responsePromise } = requestAvatar("alice-notmine.webp", {
      characterRowsByQuery: [[]],
    });
    const response = await responsePromise;

    expect(response.status).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns 400 when key contains path traversal", async () => {
    const { get, response: responsePromise } = requestAvatar("nested/..avatar.png");
    const response = await responsePromise;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid key format" });
    expect(get).not.toHaveBeenCalled();
  });

  it("serves existing records with non-ASCII (Japanese) keys", async () => {
    const { get, response: responsePromise } = requestAvatar("初音ミク.webp", {
      auth: true,
      object: { body: "webp-bytes" },
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(get).toHaveBeenCalledWith("avatars/初音ミク.webp");
  });

  it("serves the R2 object without touching bundled assets when R2 hits", async () => {
    const { assetFetch, response: responsePromise } = requestAvatar("char-rio.jpg", {
      object: { body: "r2-bytes" },
      characterRowsByQuery: [[{ id: "official-char" }]],
      bundledAssets: {
        "/avatars/char-rio.jpg": { body: "bundled-bytes", contentType: "image/jpeg" },
      },
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("r2-bytes");
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("falls back to the bundled static asset when an official avatar is missing from R2", async () => {
    const { assetFetch, response: responsePromise } = requestAvatar("char-rio.jpg", {
      object: null,
      characterRowsByQuery: [[{ id: "official-char" }]],
      bundledAssets: {
        "/avatars/char-rio.jpg": { body: "bundled-bytes", contentType: "image/jpeg" },
      },
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(await response.text()).toBe("bundled-bytes");
    expect(assetFetch).toHaveBeenCalled();
  });

  it("falls back to the bundled static asset for an owned private avatar missing from R2", async () => {
    const { response: responsePromise } = requestAvatar("mychar.jpg", {
      auth: true,
      object: null,
      bundledAssets: {
        "/avatars/mychar.jpg": { body: "bundled-bytes", contentType: "image/jpeg" },
      },
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400, must-revalidate");
    expect(await response.text()).toBe("bundled-bytes");
  });

  it("returns 404 when R2 misses and nothing is bundled", async () => {
    const { assetFetch, response: responsePromise } = requestAvatar("char-missing.jpg", {
      object: null,
      characterRowsByQuery: [[{ id: "official-char" }]],
    });
    const response = await responsePromise;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(assetFetch).toHaveBeenCalled();
  });

  it("does not treat an SPA index.html fallback as a bundled avatar", async () => {
    const { response: responsePromise } = requestAvatar("char-missing.jpg", {
      object: null,
      characterRowsByQuery: [[{ id: "official-char" }]],
      bundledAssets: {
        "/avatars/char-missing.jpg": { body: "<!doctype html>", contentType: "text/html" },
      },
    });
    const response = await responsePromise;

    expect(response.status).toBe(404);
  });

  it("never serves a bundled asset to a non-owner of a private avatar", async () => {
    const {
      get,
      assetFetch,
      response: responsePromise,
    } = requestAvatar("secret-notmine.jpg", {
      auth: true,
      object: null,
      characterRowsByQuery: [[], []],
      bundledAssets: {
        "/avatars/secret-notmine.jpg": { body: "bundled-bytes", contentType: "image/jpeg" },
      },
    });
    const response = await responsePromise;

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(get).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("never serves a bundled asset to an unauthenticated private avatar request", async () => {
    const { assetFetch, response: responsePromise } = requestAvatar("secret-notmine.jpg", {
      characterRowsByQuery: [[]],
      bundledAssets: {
        "/avatars/secret-notmine.jpg": { body: "bundled-bytes", contentType: "image/jpeg" },
      },
    });
    const response = await responsePromise;

    expect(response.status).toBe(401);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("does not look for a bundled asset for sub/ keys", async () => {
    const { assetFetch, response: responsePromise } = requestAvatar("sub/char-1/pose.jpg", {
      object: null,
      characterRowsByQuery: [
        [],
        [{ id: "char-1", subAvatars: JSON.stringify(["sub/char-1/pose.jpg"]) }],
      ],
    });
    const response = await responsePromise;

    expect(response.status).toBe(404);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("avatar key validation rejects leading/trailing slashes and allows Unicode", () => {
    const isInvalidKey = (key: string): boolean =>
      key.includes("..") || key.startsWith("/") || key.endsWith("/") || key.includes("\0");

    expect(isInvalidKey("/alice.png")).toBe(true);
    expect(isInvalidKey("alice/")).toBe(true);
    expect(isInvalidKey("nested/..avatar.png")).toBe(true);
    expect(isInvalidKey("初音ミク.webp")).toBe(false);
    expect(isInvalidKey("nested/alice.webp")).toBe(false);
    expect(isInvalidKey("a")).toBe(false);
  });
});

describe("GET /api/characters", () => {
  it("includes official characters for a logged-in non-owner", async () => {
    const response = await app.request(
      "/api/characters",
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
      {
        AUTH_TOKEN,
        DB: makeD1Mock([
          [
            {
              id: "official-char",
              userId: "seed@example.com",
              name: "Official Alice",
              nameReading: null,
              avatar: "official/alice.webp",
              isOfficial: true,
              slug: null,
              subAvatars: null,
              gender: null,
              userPersonaName: null,
              userPersonaGender: null,
              userPersonaPersonality: null,
              systemPrompt: "system",
              visualPrompt: null,
              greeting: "hello",
              tags: JSON.stringify([]),
              loraModel: null,
              loraWeight: null,
              loraTriggerPrompt: null,
              createdAt: 1,
            },
          ],
        ]),
        BUCKET: { get: vi.fn() },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      characters: [
        {
          id: "official-char",
          userId: "seed@example.com",
          name: "Official Alice",
          avatar: "official/alice.webp",
          isOfficial: true,
        },
      ],
    });
  });
});
