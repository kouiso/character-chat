import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadProactiveSettings,
  ProactiveRequestError,
  saveProactiveSettings,
} from "./proactive-notification-client";

const state = {
  characterId: "synthetic",
  settings: { enabled: false, dailyLimit: 3, idleMinutes: 60, quietHours: null },
  schedule: null,
  timeZone: "Asia/Tokyo",
  deliveryMode: "mock-only",
};
afterEach(() => vi.unstubAllGlobals());

describe("proactive settings client", () => {
  it("same-origin/no-storeで読み、所有者IDを更新bodyへ含めない", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(state), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadProactiveSettings("/api/proactive/synthetic", "synthetic")).toEqual(state);
    await saveProactiveSettings("/api/proactive/synthetic", "synthetic", state.settings);
    const options = fetchMock.mock.calls[1][1] as RequestInit;
    expect(options.credentials).toBe("same-origin");
    expect(options.cache).toBe("no-store");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(String(options.body))).toEqual(state.settings);
  });

  it("別characterの応答や壊れたsettingsを採用しない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...state, characterId: "another" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...state, settings: { ...state.settings, dailyLimit: -1 } })),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      loadProactiveSettings("/api/proactive/synthetic", "synthetic"),
    ).rejects.toBeInstanceOf(ProactiveRequestError);
    await expect(
      loadProactiveSettings("/api/proactive/synthetic", "synthetic"),
    ).rejects.toBeInstanceOf(ProactiveRequestError);
  });

  it("認証失効・利用不可のHTTP応答を固定messageへ写す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("synthetic-private-detail", { status: 401 })),
    );
    await expect(loadProactiveSettings("/api/proactive/synthetic", "synthetic")).rejects.toThrow(
      "ログインを確認して設定を再読み込みしてください。",
    );
  });
});
