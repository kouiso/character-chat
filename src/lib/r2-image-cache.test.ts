import { describe, expect, it } from "vitest";

import {
  app,
  resolveStoredMessageImageUrl,
  validateAllowedImageUrl,
} from "../../functions/api/[[route]]";

const AUTH_TOKEN = "test-token";

// drizzle-orm の D1 セッションが呼ぶ prepare → bind → run/all/raw を最低限実装したモック
// SELECT クエリは values() → raw() の経路を通るため raw も必要。
// LOCAL_USER_EMAIL = "sukererion@gmail.com"（getUserEmail が bearer token 認証で返す値）
const LOCAL_USER_EMAIL = "sukererion@gmail.com";
// SELECT { userId } に対して raw() が正しい値を返すよう userId のみを持つ行をデフォルトにする。
const makeD1Mock = (rows: Record<string, unknown>[] = [{ userId: LOCAL_USER_EMAIL }]) => ({
  prepare: () => ({
    bind: () => ({
      run: () => Promise.resolve({ success: true, meta: {} }),
      all: () => Promise.resolve({ results: rows, success: true }),
      first: () => Promise.resolve(rows[0] ?? null),
      raw: <T = unknown[]>() => Promise.resolve(rows.map((r) => Object.values(r)) as T[]),
    }),
  }),
  dump: () => Promise.resolve(new ArrayBuffer(0)),
  batch: () => Promise.resolve([]),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
});

const requestImagePersist = (imageUrl: string) =>
  app.request(
    "/api/image/persist",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageUrl, messageId: "message-1" }),
    },
    { AUTH_TOKEN, DB: makeD1Mock() },
  );

describe("R2 image cache", () => {
  it("serves authenticated R2 images with private short-lived caching", async () => {
    const imageKey = "images/123e4567-e89b-12d3-a456-426614174000.png";
    const requestedKeys: string[] = [];

    const response = await app.request(
      `/api/image/r2/${imageKey}`,
      {
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
      },
      {
        AUTH_TOKEN,
        DB: makeD1Mock(),
        BUCKET: {
          get: (key: string) => {
            requestedKeys.push(key);
            return Promise.resolve({
              body: "png-bytes",
              httpMetadata: { contentType: "image/png" },
            });
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(requestedKeys).toEqual([imageKey]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("prefers the durable R2 URL when both image_url and image_key exist", () => {
    expect(
      resolveStoredMessageImageUrl(
        "https://image.novita.ai/temporary-output.jpg",
        "images/123e4567-e89b-12d3-a456-426614174000.jpg",
      ),
    ).toBe("/api/image/r2/images/123e4567-e89b-12d3-a456-426614174000.jpg");
  });

  it("keeps the provider URL until R2 persistence has produced a valid key", () => {
    expect(resolveStoredMessageImageUrl("https://image.novita.ai/temporary-output.jpg", null)).toBe(
      "https://image.novita.ai/temporary-output.jpg",
    );
    expect(
      resolveStoredMessageImageUrl("https://image.novita.ai/temporary-output.jpg", "../bad.png"),
    ).toBe("https://image.novita.ai/temporary-output.jpg");
  });
});

describe("image source URL validation", () => {
  it.each(["data:image/png;base64,iVBORw0KGgo=", "file:///etc/passwd", "javascript:alert(1)"])(
    "rejects disallowed scheme %s with 400",
    async (imageUrl) => {
      const response = await requestImagePersist(imageUrl);

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("disallowed image source scheme");
    },
  );

  it("rejects an HTTPS URL from a disallowed host with 400", async () => {
    const response = await requestImagePersist("https://evil.example.com/img.png");

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("disallowed image source");
  });

  it.each(["not a url", "http://%", "http://[::1"])(
    "rejects malformed image URL %s without throwing",
    (imageUrl) => {
      expect(validateAllowedImageUrl(imageUrl)).toEqual({
        ok: false,
        error: "disallowed image source",
        status: 400,
      });
    },
  );

  it("allows HTTPS image URLs from an allowed host", () => {
    const result = validateAllowedImageUrl("https://image.novita.ai/img.png");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsedUrl.protocol).toBe("https:");
      expect(result.parsedUrl.hostname).toBe("image.novita.ai");
    }
  });
});
