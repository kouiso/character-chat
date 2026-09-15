import { describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// functions/api/routes/avatar.ts の POST /avatar/upload を検証する。
// 守るのは「誰が上げられるか」「何を受け付けるか」「R2 に何が落ちるか」の3点。

const AUTH_TOKEN = "test-token";

// getUserEmail は Host が localhost やと無条件で本人扱いする（route-context.ts:1734）。
// 既定ホストのまま叩くと未認証ケースが別の理由で通ってまうため、本番相当で固定する。
const ORIGIN = "https://adult-ai-chat.pages.dev";

const SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

// Hono の型推論では json() が unknown に落ちる。素の as は eslint の
// no-unnecessary-type-assertion に弾かれるため、読み側でジェネリクスを与える。
const readJson = async <T>(res: { json: () => Promise<unknown> }): Promise<T> =>
  (await res.json()) as T;

type PutCall = {
  key: string;
  bytes: Uint8Array;
  options?: { httpMetadata?: { contentType?: string } };
};

const uploadAvatar = (
  body: unknown,
  options: { auth?: boolean; rawBody?: string } = { auth: true },
) => {
  const puts: PutCall[] = [];
  const put = vi.fn((key: string, bytes: Uint8Array, putOptions?: PutCall["options"]) => {
    puts.push({ key, bytes, options: putOptions });
    return Promise.resolve({});
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) headers.Authorization = `Bearer ${AUTH_TOKEN}`;

  return {
    put,
    puts,
    response: app.request(
      `${ORIGIN}/api/avatar/upload`,
      {
        method: "POST",
        headers,
        body: options.rawBody ?? JSON.stringify(body),
      },
      {
        AUTH_TOKEN,
        // BASIC_AUTH_* は未設定にして、未認証ケースが Basic で救われんようにする。
        DB: {} as never,
        BUCKET: { put },
      },
    ),
  };
};

// 3バイト = base64 4文字の対応を使い、巨大な入力を文字列連結だけで組む。
// 末尾のパディングブロックだけ後置するので atob も受け付ける。
const zeroBase64OfSize = (byteLength: number): string => {
  const wholeBlocks = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  let encoded = "AAAA".repeat(wholeBlocks);
  if (remainder === 1) encoded += "AA==";
  else if (remainder === 2) encoded += "AAA=";
  return encoded;
};

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];
const PNG_MAGIC_BASE64 = "iVBORw==";

describe("POST /api/avatar/upload", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    const { put, response: responsePromise } = uploadAvatar(
      { data: `data:image/png;base64,${PNG_MAGIC_BASE64}`, mimeType: "image/png" },
      { auth: false },
    );
    const response = await responsePromise;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(put).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_input when data is missing or not a string", async () => {
    for (const body of [
      { mimeType: "image/png" },
      { data: null, mimeType: "image/png" },
      { data: 12345, mimeType: "image/png" },
      { data: { base64: PNG_MAGIC_BASE64 }, mimeType: "image/png" },
    ]) {
      const { put, response: responsePromise } = uploadAvatar(body);
      const response = await responsePromise;

      expect(response.status, JSON.stringify(body)).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_input" });
      expect(put).not.toHaveBeenCalled();
    }
  });

  it("returns 400 invalid_input when mimeType is missing or empty", async () => {
    for (const body of [
      { data: PNG_MAGIC_BASE64 },
      { data: PNG_MAGIC_BASE64, mimeType: "" },
      { data: PNG_MAGIC_BASE64, mimeType: null },
    ]) {
      const { put, response: responsePromise } = uploadAvatar(body);
      const response = await responsePromise;

      expect(response.status, JSON.stringify(body)).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_input" });
      expect(put).not.toHaveBeenCalled();
    }
  });

  it("returns 400 invalid_input for a mimeType outside the allowlist", async () => {
    for (const mimeType of [
      "image/gif",
      "image/svg+xml",
      "text/html",
      "application/octet-stream",
      "image/PNG",
    ]) {
      const { put, response: responsePromise } = uploadAvatar({
        data: `data:${mimeType};base64,${PNG_MAGIC_BASE64}`,
        mimeType,
      });
      const response = await responsePromise;

      expect(response.status, mimeType).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_input" });
      expect(put, mimeType).not.toHaveBeenCalled();
    }
  });

  it("returns 400 invalid_input when the body is not JSON at all", async () => {
    const { put, response: responsePromise } = uploadAvatar(undefined, {
      auth: true,
      rawBody: "not-json",
    });
    const response = await responsePromise;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_input" });
    expect(put).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_base64 when the payload after the data URL prefix is not base64", async () => {
    const { put, response: responsePromise } = uploadAvatar({
      data: "data:image/png;base64,@@@@",
      mimeType: "image/png",
    });
    const response = await responsePromise;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_base64" });
    expect(put).not.toHaveBeenCalled();
  });

  it("returns 400 file_too_large one byte past the 5MB ceiling", async () => {
    const { put, response: responsePromise } = uploadAvatar({
      data: `data:image/png;base64,${zeroBase64OfSize(SIZE_LIMIT_BYTES + 1)}`,
      mimeType: "image/png",
    });
    const response = await responsePromise;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "file_too_large" });
    expect(put).not.toHaveBeenCalled();
  });

  // 上限ちょうどは通る側。ここが無いと比較を >= へ倒す改変が検知でけへん。
  it("accepts a payload of exactly 5MB", async () => {
    const { puts, response: responsePromise } = uploadAvatar({
      data: `data:image/png;base64,${zeroBase64OfSize(SIZE_LIMIT_BYTES)}`,
      mimeType: "image/png",
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(puts).toHaveLength(1);
    expect(puts[0].bytes.length).toBe(SIZE_LIMIT_BYTES);
  });

  it("stores the decoded bytes under avatars/<userEmail>/<uuid>.<ext> and echoes the prefixed key", async () => {
    const { puts, response: responsePromise } = uploadAvatar({
      data: `data:image/png;base64,${PNG_MAGIC_BASE64}`,
      mimeType: "image/png",
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    const payload = await readJson<{ avatarKey: string }>(response);

    // キーは userEmail/<uuid>.<ext> 形式。配信側 GET /avatar/:key はこのまま使う。
    const parts = payload.avatarKey.split("/");
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe("sukererion@gmail.com");
    const fileName = parts[1];
    const [uuid, ext] = fileName.split(".");
    expect(ext).toBe("png");
    expect(uuid).toMatch(/^[\da-f-]+$/);
    expect(uuid.split("-").map((segment) => segment.length)).toEqual([8, 4, 4, 4, 12]);
    expect(payload.avatarKey.startsWith("avatars/")).toBe(false);

    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(`avatars/${payload.avatarKey}`);
    expect(Array.from(puts[0].bytes)).toEqual(PNG_MAGIC_BYTES);
    expect(puts[0].options?.httpMetadata?.contentType).toBe("image/png");
  });

  it("accepts raw base64 without a data URL prefix", async () => {
    const { puts, response: responsePromise } = uploadAvatar({
      data: PNG_MAGIC_BASE64,
      mimeType: "image/png",
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(Array.from(puts[0].bytes)).toEqual(PNG_MAGIC_BYTES);
  });

  it("derives the extension and contentType from each allowed mimeType", async () => {
    for (const [mimeType, ext] of [
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
    ] as const) {
      const { puts, response: responsePromise } = uploadAvatar({
        data: `data:${mimeType};base64,${PNG_MAGIC_BASE64}`,
        mimeType,
      });
      const response = await responsePromise;

      expect(response.status, mimeType).toBe(200);
      const payload = await readJson<{ avatarKey: string }>(response);

      expect(payload.avatarKey.endsWith(`.${ext}`), mimeType).toBe(true);
      expect(puts[0].key, mimeType).toBe(`avatars/${payload.avatarKey}`);
      expect(puts[0].options?.httpMetadata?.contentType, mimeType).toBe(mimeType);
    }
  });

  it("gives every upload a distinct key", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await uploadAvatar({
        data: PNG_MAGIC_BASE64,
        mimeType: "image/webp",
      }).response;
      keys.push((await readJson<{ avatarKey: string }>(response)).avatarKey);
    }

    expect(new Set(keys).size).toBe(3);
  });
});
