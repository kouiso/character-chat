// ローカル D1 に migrations を適用し、getPlatformProxy 経由で character テーブルへ疎通できることを確認する。
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyLocalMigrations } from "./migrate";

import { createPlatform, type Platform } from "./index";

describe("createPlatform", () => {
  let platform: Platform;

  beforeAll(async () => {
    applyLocalMigrations();
    platform = await createPlatform();
  });

  afterAll(async () => {
    await platform.dispose();
  });

  it("ローカル D1 の character テーブルへ疎通する", async () => {
    const row = await platform.env.DB.prepare("select count(*) as n from character").first<{
      n: number;
    }>();
    expect(row).not.toBeNull();
    expect(typeof row?.n).toBe("number");
    expect(row?.n).toBeGreaterThanOrEqual(0);
  });

  it("CLI から本番への接続を許可しない", async () => {
    await expect(createPlatform({ remote: true })).rejects.toThrow("ローカル限定");
  });
});
