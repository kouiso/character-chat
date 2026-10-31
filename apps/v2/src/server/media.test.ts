// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { R2_KEY_PATTERN, serveOwnedImage } from "./media";

const IMAGE_KEY = "images/0f8fad5b-d9cb-469f-a165-70867728950e.png";

const bucketWith = (contentType: string | null = "image/png") => {
  const get = vi.fn(async () => ({
    body: new Blob(["png"]).stream(),
    httpMetadata: { contentType: contentType ?? undefined },
  }));
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
    const { bucket: untyped } = bucketWith(null);
    expect((await serveOwnedImage(IMAGE_KEY, untyped)).status).toBe(415);
  });
});
