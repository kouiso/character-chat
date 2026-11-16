// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { avatarKey, canServeAvatar, resolveAvatar, type AvatarEnv } from "./avatar";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const HTML_BYTES = new TextEncoder().encode("<!doctype html><p>not image</p>");

const REQUEST_URL = "https://example.test/api/characters/c1/avatar";

const assetsWith = (files: Record<string, string>) => ({
  fetch: vi.fn(async (input: Request | string) => {
    const path = new URL(typeof input === "string" ? input : input.url).pathname;
    const type = files[path];
    return type
      ? new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": type },
        })
      : // 静的配信は無いパスへ 404 を返す（型は text/html）。
        new Response(HTML_BYTES, { status: 404, headers: { "content-type": "text/html" } });
  }),
});

const bucketWith = (
  objects: Record<string, { size?: number; type?: string; bytes?: Uint8Array }>,
) => ({
  head: vi.fn(async (key: string) => {
    const object = objects[key];
    if (!object) return null;
    const size = object.size ?? object.bytes?.byteLength ?? 100;
    return {
      size,
      httpMetadata: object.type !== undefined ? { contentType: object.type } : {},
    } as R2Object;
  }),
  get: vi.fn(async (key: string) => {
    const object = objects[key];
    if (!object) return null;
    const bytes = object.bytes ?? PNG_BYTES;
    const blob = new Blob([bytes]);
    return {
      body: blob.stream(),
      arrayBuffer: () => blob.arrayBuffer(),
      size: bytes.byteLength,
      httpMetadata: object.type !== undefined ? { contentType: object.type } : {},
    } as unknown as R2ObjectBody;
  }),
});

const env = (
  files: Record<string, string>,
  objects: Record<string, { size?: number; type?: string; bytes?: Uint8Array }>,
): AvatarEnv & { assets: ReturnType<typeof assetsWith>; bucket: ReturnType<typeof bucketWith> } => {
  const assets = assetsWith(files);
  const bucket = bucketWith(objects);
  return { ASSETS: assets, BUCKET: bucket, assets, bucket };
};

describe("resolveAvatar", () => {
  it("avatar が空なら unset（資産もR2も呼ばん）", async () => {
    const e = env({}, {});
    for (const avatar of [null, ""]) {
      expect(await resolveAvatar(e, REQUEST_URL, avatar, "check")).toEqual({ status: "unset" });
    }
    expect(e.assets.fetch).not.toHaveBeenCalled();
    expect(e.bucket.head).not.toHaveBeenCalled();
  });

  it("..・末尾 /・NUL の値は bad_key（資産を別の名で指させん）", async () => {
    const e = env({}, {});
    for (const avatar of ["../secret", "/avatars/../x.png", "a/b/", "x\0.png"]) {
      expect(await resolveAvatar(e, REQUEST_URL, avatar, "check")).toEqual({
        status: "bad_key",
      });
    }
    expect(e.assets.fetch).not.toHaveBeenCalled();
  });

  it("同梱に在れば bundled で R2 は読まん", async () => {
    const e = env({ "/avatars/char-akane.jpg": "image/jpeg" }, { "avatars/char-akane.jpg": {} });
    const hit = await resolveAvatar(e, REQUEST_URL, "char-akane.jpg", "check");
    expect(hit.status).toBe("bundled");
    expect(e.bucket.head).not.toHaveBeenCalled();
  });

  it("R2 は avatars/<鍵> を先に、直下の <鍵> を次に探す", async () => {
    const e = env({}, { "avatars/char-b.jpg": { type: "image/png" } });
    const hit = await resolveAvatar(e, REQUEST_URL, "char-b.jpg", "check");
    expect(hit.status).toBe("r2");
    expect(e.bucket.head.mock.calls.map((call) => call[0])).toEqual(["avatars/char-b.jpg"]);
  });

  it("旧アプリが置いた <利用者ID>/<UUID>.jpg は R2 の直下から解ける", async () => {
    const key = "user-123/0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
    const e = env({}, { [key]: { type: "image/jpeg" } });
    const hit = await resolveAvatar(e, REQUEST_URL, key, "check");
    expect(hit.status).toBe("r2");
    expect(e.bucket.head.mock.calls.map((call) => call[0])).toEqual([`avatars/${key}`, key]);
    // 同梱の絵の方は区画ごとに encode されたパスで探す。
    const bundledPaths = e.assets.fetch.mock.calls.map(
      (call) => new URL(call[0] instanceof Request ? call[0].url : String(call[0])).pathname,
    );
    expect(bundledPaths).toEqual([`/avatars/${key}`]);
  });

  it("1 バイト以下の R2 オブジェクトは実画像と扱わん", async () => {
    const e = env({}, { "avatars/char-c.jpg": { size: 1 }, "char-c.jpg": { size: 0 } });
    const hit = await resolveAvatar(e, REQUEST_URL, "char-c.jpg", "check");
    expect(hit.status).toBe("missing");
    expect(e.bucket.get).not.toHaveBeenCalled();
  });

  it("同梱にも R2 にも無ければ missing", async () => {
    const e = env({}, {});
    expect((await resolveAvatar(e, REQUEST_URL, "/avatars/x.png", "check")).status).toBe("missing");
  });

  it("R2 に在る物が画像でない（HTML）なら not_image", async () => {
    const e = env(
      {},
      { "avatars/char-d.jpg": { type: "text/html", size: 100, bytes: HTML_BYTES } },
    );
    const hit = await resolveAvatar(e, REQUEST_URL, "char-d.jpg", "check");
    expect(hit.status).toBe("not_image");
  });

  it("型名乗りの無い R2 オブジェクトは先頭バイトで画像と分かれば r2", async () => {
    const e = env({}, { "avatars/char-e.jpg": { size: 100, bytes: PNG_BYTES } });
    const hit = await resolveAvatar(e, REQUEST_URL, "char-e.jpg", "check");
    expect(hit.status).toBe("r2");
    if (hit.status === "r2") expect(hit.type).toBe("image/png");
    expect(e.bucket.get).toHaveBeenCalledWith("avatars/char-e.jpg", {
      range: { offset: 0, length: 12 },
    });
  });

  it("serve は同梱の応答本体をそのまま返す", async () => {
    const e = env({ "/avatars/char-akane.jpg": "image/jpeg" }, {});
    const hit = await resolveAvatar(e, REQUEST_URL, "char-akane.jpg", "serve");
    expect(hit.status).toBe("bundled");
    if (hit.status === "bundled") {
      expect(hit.type).toBe("image/jpeg");
      expect(new Uint8Array(await new Response(hit.body).arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
    }
  });

  it("serve は R2 の本体を型付きで返す（型名乗りが画像ならバイトを読まん）", async () => {
    const e = env({}, { "avatars/char-f.jpg": { type: "image/png", bytes: PNG_BYTES } });
    const hit = await resolveAvatar(e, REQUEST_URL, "char-f.jpg", "serve");
    expect(hit.status).toBe("r2");
    if (hit.status === "r2") {
      expect(hit.type).toBe("image/png");
      expect(new Uint8Array(await new Response(hit.body).arrayBuffer())).toEqual(PNG_BYTES);
    }
  });
});

describe("avatarKey", () => {
  it("ファイル名形・パス形を同じ鍵に潰す", () => {
    expect(avatarKey("char-akane.jpg")).toBe("char-akane.jpg");
    expect(avatarKey("/avatars/char-akane.jpg")).toBe("char-akane.jpg");
    expect(avatarKey("///avatars//char-akane.jpg")).toBe("char-akane.jpg");
  });
});

// canServeAvatar の問い合わせは D1 偽物で形だけ確かめる（集合・公開の組合せは
// api-avatar.test.ts / api-character-check.test.ts が実 D1 で通す）。
describe("canServeAvatar", () => {
  it("配ってよい行の avatar 値を返し、よくない行は null", async () => {
    const calls: { sql: string; binds: unknown[] }[] = [];
    const rows = new Map<string, { avatar: string | null }>([["char-a", { avatar: "a.jpg" }]]);
    const db = {
      prepare: (sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds });
          return { first: async () => rows.get(String(binds[0])) ?? null };
        },
      }),
    } as unknown as D1Database;
    expect(await canServeAvatar(db, "char-a", ["local", "legacy-1"])).toEqual({
      avatar: "a.jpg",
    });
    expect(await canServeAvatar(db, "char-b", ["local", "legacy-1"])).toBeNull();
    expect(calls[0].sql).toContain("v2_character_publish");
    expect(calls[0].binds).toEqual(["char-a", "local", "legacy-1"]);
  });
});
