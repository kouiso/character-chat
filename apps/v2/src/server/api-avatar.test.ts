// @vitest-environment node
// GET /api/characters/:id/avatar（routes/api/characters/$id_/avatar.ts）の結合確かめ。
// D1 は手元のローカル、ASSETS・BUCKET は偽物。
import { characterTable, userTable } from "@v2/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { handleAvatarRequest } from "../routes/api/characters/$id_/avatar";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

const mocks = vi.hoisted(() => ({
  assetsFetch: vi.fn(async () => new Response(null, { status: 404 })),
  bucketHead: vi.fn<(key: string) => Promise<unknown>>(async () => null),
  bucketGet: vi.fn<(key: string, options?: unknown) => Promise<unknown>>(async () => null),
  d1: { current: null as D1Database | null },
}));

vi.mock("./platform", () => ({
  getPlatform: vi.fn(async () => ({
    env: {
      get DB() {
        return mocks.d1.current;
      },
      ASSETS: { fetch: mocks.assetsFetch },
      BUCKET: { head: mocks.bucketHead, get: mocks.bucketGet },
    },
  })),
}));

const request = (id: string) =>
  new Request(`https://example.test/api/characters/${encodeURIComponent(id)}/avatar`);

describe("GET /api/characters/:id/avatar", () => {
  let local: LocalD1;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const stranger = `stranger-${crypto.randomUUID().slice(0, 8)}`;
  const privateChar = `char-private-${crypto.randomUUID().slice(0, 8)}`;
  const publishedChar = `char-published-${crypto.randomUUID().slice(0, 8)}`;

  const insertCharacter = async (id: string, userId: string, avatar: string | null) =>
    local.db.insert(characterTable).values({
      id,
      userId,
      name: "検査キャラ",
      systemPrompt: "設定",
      greeting: "こんにちは",
      tags: [],
      avatar,
      createdAt: Date.now(),
    });

  beforeAll(async () => {
    local = await openLocalD1();
    mocks.d1.current = local.d1;
    await local.db.insert(userTable).values({
      id: stranger,
      email: `${stranger}@example.invalid`,
      createdAt: Date.now(),
    });
    await insertCharacter(privateChar, stranger, "x.png");
    await insertCharacter(publishedChar, stranger, "p.png");
    await local.d1
      .prepare(
        "INSERT INTO v2_character_publish (character_id, user_id, published_at, created_at) VALUES (?, ?, 1, 1)",
      )
      .bind(publishedChar, stranger)
      .run();
  }, 180_000);

  afterAll(async () => {
    await local.d1
      .prepare("DELETE FROM character WHERE id IN (?, ?)")
      .bind(privateChar, publishedChar)
      .run();
    await local.d1.prepare("DELETE FROM user WHERE id = ?").bind(stranger).run();
    await local.d1
      .prepare("DELETE FROM v2_character_publish WHERE character_id = ?")
      .bind(publishedChar)
      .run();
    await local.dispose();
  });

  it("見えない・公開もされていないキャラは 404 character_not_found", async () => {
    const response = await handleAvatarRequest(privateChar, request(privateChar));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "character_not_found" });
    expect(mocks.assetsFetch).not.toHaveBeenCalled();
    expect(mocks.bucketHead).not.toHaveBeenCalled();
  });

  it("存在しない id も 404 character_not_found", async () => {
    const response = await handleAvatarRequest("char-not-exists", request("char-not-exists"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "character_not_found" });
  });

  it("公開済みのキャラは配ってよい（R2 から 200）", async () => {
    mocks.bucketHead.mockResolvedValueOnce({
      size: 100,
      httpMetadata: { contentType: "image/png" },
    } as R2Object);
    const blob = new Blob([png]);
    mocks.bucketGet.mockResolvedValueOnce({
      body: blob.stream(),
      arrayBuffer: () => blob.arrayBuffer(),
      httpMetadata: { contentType: "image/png" },
    } as unknown as R2ObjectBody);
    const response = await handleAvatarRequest(publishedChar, request(publishedChar));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("avatar が空なら 404 avatar_unset", async () => {
    const emptyChar = `char-empty-${crypto.randomUUID().slice(0, 8)}`;
    await insertCharacter(emptyChar, "local", null);
    try {
      const response = await handleAvatarRequest(emptyChar, request(emptyChar));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: "avatar_unset" });
    } finally {
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(emptyChar).run();
    }
  });

  it("実体が無ければ 404 avatar_missing、R2 が倒れたら 502", async () => {
    const missingChar = `char-missing-${crypto.randomUUID().slice(0, 8)}`;
    await insertCharacter(missingChar, "local", "gone.png");
    try {
      const missing = await handleAvatarRequest(missingChar, request(missingChar));
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ code: "avatar_missing" });

      mocks.bucketHead.mockRejectedValueOnce(new Error("R2 down"));
      const failed = await handleAvatarRequest(missingChar, request(missingChar));
      expect(failed.status).toBe(502);
      expect(await failed.json()).toEqual({ code: "avatar_storage_failed" });
    } finally {
      await local.d1.prepare("DELETE FROM character WHERE id = ?").bind(missingChar).run();
    }
  });
});
