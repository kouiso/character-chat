// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { R2_KEY_PATTERN, serveOwnedImage } from "./media";

const IMAGE_KEY = "images/0f8fad5b-d9cb-469f-a165-70867728950e.png";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const HTML_BYTES = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

const bucketWith = (
  contentType: string | null = "image/png",
  bytes: Uint8Array<ArrayBuffer> = PNG_BYTES,
) => {
  const get = vi.fn(async () => {
    const blob = new Blob([bytes]);
    return {
      body: blob.stream(),
      arrayBuffer: () => blob.arrayBuffer(),
      httpMetadata: { contentType: contentType ?? undefined },
    };
  });
  return { bucket: { get } as unknown as Pick<R2Bucket, "get">, get };
};

describe("旧メッセージ画像の配信", () => {
  it("旧アプリと同じR2キー規則を使う", () => {
    // 旧ファイルを import すると旧アプリ全体の型検査を v2 に引き込むので、本文から読む
    const legacy = readFileSync(
      new URL("../../../../functions/api/lib/route-context.ts", import.meta.url),
      "utf8",
    );
    expect(legacy).toContain(`export const R2_KEY_PATTERN = ${String(R2_KEY_PATTERN)};`);
  });

  it.each([IMAGE_KEY, "images/abc-123.jpg", "sub/char-koharu-ex/pose_1.v2.jpg"])(
    "規則に合う %s は配信する",
    async (key) => {
      const { bucket, get } = bucketWith();
      const response = await serveOwnedImage(key, bucket);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(get).toHaveBeenCalledWith(key);
    },
  );

  it.each([
    "preserved-image.png",
    "image-gen-task/abcd.json",
    "images/../image-gen-task/abcd.json",
    "images/0f8fad5b-d9cb-469f-a165-70867728950e.webp",
    "images/ABC.png",
    "sub/char/../../secret.png",
    "sub/char/nested/file.png",
    `${IMAGE_KEY}\n`,
    ` ${IMAGE_KEY}`,
    "",
  ])("規則に合わない %j はR2を読まず404にする", async (key) => {
    const { bucket, get } = bucketWith();
    const response = await serveOwnedImage(key, bucket);
    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("持ち主の画像が無いときは404にする", async () => {
    const { bucket, get } = bucketWith();
    expect((await serveOwnedImage(null, bucket)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("R2に実体が無ければ404、画像以外の型なら415にする", async () => {
    const missing = { get: vi.fn(async () => null) } as unknown as Pick<R2Bucket, "get">;
    expect((await serveOwnedImage(IMAGE_KEY, missing)).status).toBe(404);
    const { bucket } = bucketWith("text/html");
    expect((await serveOwnedImage(IMAGE_KEY, bucket)).status).toBe(415);
  });

  // 旧アプリは送り元が image/jpg と名乗った画像をその型のまま R2 に保存しとる。
  it.each(["image/jpg", "image/JPEG", "image/jpeg; charset=binary"])(
    "旧アプリが保存した %s は image/jpeg として配信する",
    async (contentType) => {
      const { bucket } = bucketWith(contentType, JPEG_BYTES);
      const response = await serveOwnedImage("images/abc-123.jpg", bucket);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG_BYTES);
    },
  );

  // 型の無い画像も旧アプリは配信しとった。拡張子は信用せず、先頭のバイトで判断する。
  it.each([
    [null, PNG_BYTES, "image/png"],
    [null, JPEG_BYTES, "image/jpeg"],
    ["application/octet-stream", JPEG_BYTES, "image/jpeg"],
    ["", PNG_BYTES, "image/png"],
  ])("型が %j の実体は中身の先頭で画像と分かれば配信する", async (contentType, bytes, expected) => {
    const { bucket } = bucketWith(contentType, bytes);
    const response = await serveOwnedImage(IMAGE_KEY, bucket);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(expected);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    [null, HTML_BYTES],
    ["application/octet-stream", HTML_BYTES],
    [null, new Uint8Array([0x89, 0x50])],
    [null, new Uint8Array([])],
  ])("型が %j で中身も画像でなければ415にする", async (contentType, bytes) => {
    const { bucket } = bucketWith(contentType, bytes);
    expect((await serveOwnedImage(IMAGE_KEY, bucket)).status).toBe(415);
  });
});
