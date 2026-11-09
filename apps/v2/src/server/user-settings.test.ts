// RIT-199: セーフモード設定の確かめ — 既定 OFF・set/read の往復・upsert・
// API GET/PUT・他ユーザーへの非波及を実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleSettingsReadRequest, handleSettingsWriteRequest } = await import("./api-settings");
const { readSafeMode, setSafeMode } = await import("./user-settings");

let local: LocalD1;
const T0 = Date.UTC(2026, 10, 10, 0, 0, 0);

beforeAll(async () => {
  local = await openLocalD1();
  platform.env = { DB: local.d1 };
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

describe("readSafeMode / setSafeMode", () => {
  it("行が無いユーザーは既定で OFF", async () => {
    expect(await readSafeMode(local.d1, `u-${crypto.randomUUID()}`)).toBe(false);
  });

  it("ON/OFF を往復でき、書き込みは冪等に upsert される", async () => {
    const userId = `u-${crypto.randomUUID()}`;
    await setSafeMode(local.d1, userId, true, T0);
    expect(await readSafeMode(local.d1, userId)).toBe(true);
    // 再書き込みも行が増えず値だけ更新される。
    await setSafeMode(local.d1, userId, false, T0 + 1000);
    expect(await readSafeMode(local.d1, userId)).toBe(false);
    const count = await local.d1
      .prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM v2_user_settings WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number; m: number }>();
    expect(count?.n).toBe(1);
    expect(count?.m).toBe(T0 + 1000);
  });

  it("他ユーザーの設定には影響しない", async () => {
    const a = `u-${crypto.randomUUID()}`;
    const b = `u-${crypto.randomUUID()}`;
    await setSafeMode(local.d1, a, true, T0);
    expect(await readSafeMode(local.d1, b)).toBe(false);
  });
});

describe("settings API", () => {
  it("GET は現在値、PUT で更新して次回 GET に反映される", async () => {
    const before = await (await handleSettingsReadRequest()).json();
    expect(before).toEqual({ safeMode: await readSafeMode(local.d1, "local") });

    const put = await handleSettingsWriteRequest(
      new Request("https://x/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ safeMode: true }),
      }),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ safeMode: true });
    expect(await (await handleSettingsReadRequest()).json()).toEqual({ safeMode: true });
  });

  it("PUT は型の違う safeMode を 400 で弾く", async () => {
    const res = await handleSettingsWriteRequest(
      new Request("https://x/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ safeMode: "yes" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
