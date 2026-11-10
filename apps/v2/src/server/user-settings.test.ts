// RIT-199: セーフモード設定の確かめ — 既定 OFF・set/read の往復・upsert・
// API GET/PUT・他ユーザーへの非波及を実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleSettingsReadRequest, handleSettingsWriteRequest } = await import("./api-settings");
const {
  readChatMode,
  readChatStyle,
  readSafeMode,
  readUserPersona,
  readVoiceAutoplay,
  setChatMode,
  setChatStyle,
  setSafeMode,
  setUserPersona,
  setVoiceAutoplay,
} = await import("./user-settings");

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

// RIT-205: チャットモード設定。
describe("readChatMode / setChatMode", () => {
  it("行が無いユーザーは既定で standard", async () => {
    expect(await readChatMode(local.d1, `u-${crypto.randomUUID()}`)).toBe("standard");
  });

  it("mode を往復でき、safe_mode を上書きせん", async () => {
    const userId = `u-${crypto.randomUUID()}`;
    await setSafeMode(local.d1, userId, true, T0);
    await setChatMode(local.d1, userId, "light", T0 + 1);
    expect(await readChatMode(local.d1, userId)).toBe("light");
    expect(await readSafeMode(local.d1, userId)).toBe(true);
    await setChatMode(local.d1, userId, "quality", T0 + 2);
    expect(await readChatMode(local.d1, userId)).toBe("quality");
  });
});

// RIT-211: ボイス自動再生設定。
describe("readVoiceAutoplay / setVoiceAutoplay", () => {
  it("行が無いユーザーは既定で OFF、往復できる", async () => {
    const userId = `u-${crypto.randomUUID()}`;
    expect(await readVoiceAutoplay(local.d1, userId)).toBe(false);
    await setVoiceAutoplay(local.d1, userId, true, T0);
    expect(await readVoiceAutoplay(local.d1, userId)).toBe(true);
    await setVoiceAutoplay(local.d1, userId, false, T0 + 1);
    expect(await readVoiceAutoplay(local.d1, userId)).toBe(false);
  });
});

// RIT-203: 文体スタイル設定。
describe("readChatStyle / setChatStyle", () => {
  it("行が無いユーザーは既定で balanced", async () => {
    expect(await readChatStyle(local.d1, `u-${crypto.randomUUID()}`)).toBe("balanced");
  });

  it("style を往復でき、safe_mode・chat_mode を上書きせん", async () => {
    const userId = `u-${crypto.randomUUID()}`;
    await setSafeMode(local.d1, userId, true, T0);
    await setChatMode(local.d1, userId, "light", T0 + 1);
    await setChatStyle(local.d1, userId, "prose", T0 + 2);
    expect(await readChatStyle(local.d1, userId)).toBe("prose");
    expect(await readSafeMode(local.d1, userId)).toBe(true);
    expect(await readChatMode(local.d1, userId)).toBe("light");
    await setChatStyle(local.d1, userId, "dialogue", T0 + 3);
    expect(await readChatStyle(local.d1, userId)).toBe("dialogue");
  });
});

describe("readUserPersona / setUserPersona", () => {
  it("行が無いユーザーは既定で空文字", async () => {
    expect(await readUserPersona(local.d1, `u-${crypto.randomUUID()}`)).toBe("");
  });

  it("往復でき、空白だけは消去（null）に倒す", async () => {
    const userId = `u-${crypto.randomUUID()}`;
    await setUserPersona(local.d1, userId, "クールぶってるが優しい先輩", T0);
    expect(await readUserPersona(local.d1, userId)).toBe("クールぶってるが優しい先輩");
    // 空文字にすると未設定へ戻る（行は残るが読み出しは空）。
    await setUserPersona(local.d1, userId, "", T0 + 1000);
    expect(await readUserPersona(local.d1, userId)).toBe("");
  });

  it("上限を超えた分は切る", async () => {
    const userId = `u-${crypto.randomUUID()}`;
    await setUserPersona(local.d1, userId, "あ".repeat(2500), T0);
    const value = await readUserPersona(local.d1, userId);
    expect(value.length).toBe(2000);
  });
});

describe("settings API", () => {
  it("GET は現在値、PUT で更新して次回 GET に反映される", async () => {
    const before = await (await handleSettingsReadRequest()).json();
    expect(before).toEqual({
      safeMode: await readSafeMode(local.d1, "local"),
      chatMode: await readChatMode(local.d1, "local"),
      style: await readChatStyle(local.d1, "local"),
      voiceAutoplay: await readVoiceAutoplay(local.d1, "local"),
      userPersona: await readUserPersona(local.d1, "local"),
    });

    const put = await handleSettingsWriteRequest(
      new Request("https://x/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ safeMode: true }),
      }),
    );
    expect(put.status).toBe(200);
    const written: { safeMode: boolean; chatMode: string } = await put.json();
    expect(written.safeMode).toBe(true);
    expect(await readSafeMode(local.d1, "local")).toBe(true);
  });

  it("PUT は渡した項目だけ更新する（chatMode だけ送っても safeMode が消えん）", async () => {
    const put = await handleSettingsWriteRequest(
      new Request("https://x/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatMode: "quality" }),
      }),
    );
    expect(put.status).toBe(200);
    const body: {
      safeMode: boolean;
      chatMode: string;
      style: string;
      voiceAutoplay: boolean;
    } = await put.json();
    const expected = {
      safeMode: true,
      chatMode: "quality",
      style: await readChatStyle(local.d1, "local"),
      voiceAutoplay: await readVoiceAutoplay(local.d1, "local"),
      userPersona: await readUserPersona(local.d1, "local"),
    };
    expect(body).toEqual(expected);
    expect(await (await handleSettingsReadRequest()).json()).toEqual(expected);
  });

  it("PUT は style だけでも更新できる", async () => {
    const put = await handleSettingsWriteRequest(
      new Request("https://x/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ style: "prose" }),
      }),
    );
    expect(put.status).toBe(200);
    expect(await readChatStyle(local.d1, "local")).toBe("prose");
    expect(await readSafeMode(local.d1, "local")).toBe(true);
    expect(await readChatMode(local.d1, "local")).toBe("quality");
  });

  it("PUT は voiceAutoplay だけでも更新でき、他列を上書きせん", async () => {
    const put = await handleSettingsWriteRequest(
      new Request("https://x/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceAutoplay: true }),
      }),
    );
    expect(put.status).toBe(200);
    expect(await readVoiceAutoplay(local.d1, "local")).toBe(true);
    expect(await readSafeMode(local.d1, "local")).toBe(true);
    expect(await readChatMode(local.d1, "local")).toBe("quality");
    expect(await readChatStyle(local.d1, "local")).toBe("prose");
  });

  it("PUT は userPersona だけでも更新でき、他列を上書きせん", async () => {
    const put = await handleSettingsWriteRequest(
      new Request("https://x/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userPersona: "寡黙な護衛役" }),
      }),
    );
    expect(put.status).toBe(200);
    expect(await readUserPersona(local.d1, "local")).toBe("寡黙な護衛役");
    expect(await readSafeMode(local.d1, "local")).toBe(true);
  });

  it("PUT は型の違う safeMode・未対応の chatMode・空の更新を 400 で弾く", async () => {
    for (const body of [
      { safeMode: "yes" },
      { chatMode: "extreme" },
      { style: "poetic" },
      { userPersona: 42 },
      {},
      { other: 1 },
    ]) {
      const res = await handleSettingsWriteRequest(
        new Request("https://x/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(400);
    }
  });
});
