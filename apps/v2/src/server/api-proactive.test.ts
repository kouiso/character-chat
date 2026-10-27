import { describe, expect, it, vi } from "vitest";

import { proactiveStateSchema } from "../lib/proactive-notification-contract";
import { createProactiveFixture } from "../test/proactive-notification-fixture";

import { createProactiveApi } from "./api-proactive";
import { createProactiveNotificationController } from "./proactive-notification-controller";

import type { ProactiveSettings } from "../lib/proactive-notification-contract";

const characterId = "synthetic-character";
const settings: ProactiveSettings = {
  enabled: true,
  dailyLimit: 3,
  idleMinutes: 1,
  quietHours: null,
};
const request = (method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://local.test/api/proactive/${characterId}`, {
    method,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
  });

const setup = () => {
  const fixture = createProactiveFixture();
  let recipient = fixture.open("local");
  const authenticate = vi.fn(async () => "local" as string | null);
  const verifyCharacter = vi.fn(async (recipientId: string, id: string) =>
    recipientId === "local" && [characterId, "another-synthetic-character"].includes(id)
      ? { proactiveSettings: { enabled: true, intervalMinutes: 60 } }
      : null,
  );
  const getRecipient = vi.fn(async () => recipient);
  const dependencies = {
    authenticate,
    verifyCharacter,
    getRecipient,
    deliveryMode: "mock-only" as const,
  };
  const api = createProactiveApi(dependencies);
  return {
    fixture,
    api,
    dependencies,
    authenticate,
    verifyCharacter,
    getRecipient,
    recipient: () => recipient,
    reopen: () => {
      recipient = fixture.open("local");
    },
  };
};

describe("proactive settings authenticated consumer", () => {
  it("profile enabledを移行せずdefaultOFF、profile間隔だけを初期候補にする", async () => {
    const test = setup();
    const response = await test.api(request(), characterId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      characterId,
      settings: { enabled: false, dailyLimit: 3, idleMinutes: 60, quietHours: null },
      schedule: null,
      timeZone: "Asia/Tokyo",
      deliveryMode: "mock-only",
    });
    expect(test.fixture.storage.values.size).toBe(0);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("本人の明示ON・JST静穏・percharacter上限を保存し、再開でも同じ予定を読む", async () => {
    const test = setup();
    const input = {
      ...settings,
      idleMinutes: 60,
      quietHours: { startMinute: 22 * 60, endMinute: 8 * 60 },
    };
    const saved = await test.api(request("PUT", input), characterId);
    expect(saved.status).toBe(200);
    const state = proactiveStateSchema.parse(await saved.json());
    expect(state.settings).toEqual(input);
    expect(state.schedule?.dueAt).toBe(Date.parse("2026-10-26T23:00:00Z"));
    test.reopen();
    expect(await (await test.api(request(), characterId)).json()).toEqual(state);
    expect(test.fixture.notifications).toHaveLength(0);
  });

  it("同じPUTを再送しても予定IDと予定時刻を先送りしない", async () => {
    const test = setup();
    const first = await (await test.api(request("PUT", settings), characterId)).json();
    const before = structuredClone(test.fixture.storage.values);
    test.fixture.advanceTo("2026-10-26T12:00:30Z");
    const replay = await (
      await test.api(
        request("PUT", { quietHours: null, idleMinutes: 1, dailyLimit: 3, enabled: true }),
        characterId,
      )
    ).json();
    expect(replay).toEqual(first);
    expect(test.fixture.storage.values).toEqual(before);
  });

  it("設定と予定を一つのtransaction snapshotで読み、並行OFFと混ぜない", async () => {
    const test = setup();
    await test.api(request("PUT", settings), characterId);
    const transaction = vi.spyOn(test.fixture.storage, "transaction");
    const response = await test.api(request(), characterId);
    expect(response.status).toBe(200);
    expect(transaction).toHaveBeenCalledOnce();
    const [beforeOff] = await Promise.all([
      test.recipient().getCharacterState(characterId),
      test.recipient().configureCharacter(characterId, { ...settings, enabled: false }),
    ]);
    expect(beforeOff.settings?.enabled).toBe(true);
    expect(beforeOff.schedule?.dueAt).not.toBeNull();
    const afterOff = await test.recipient().getCharacterState(characterId);
    expect(afterOff.settings?.enabled).toBe(false);
    expect(afterOff.schedule?.dueAt).toBeNull();
  });

  it("3通で4通目を拒否し別characterとは分離、OFFack後の古いalarmも送らない", async () => {
    const test = setup();
    await test.api(request("PUT", settings), characterId);
    for (const minute of [1, 2, 3]) {
      test.fixture.advanceTo(`2026-10-26T12:0${minute}:00Z`);
      expect((await test.recipient().runAlarm(test.fixture.sink))[0].outcome).toBe("attempted");
    }
    test.fixture.advanceTo("2026-10-26T12:04:00Z");
    expect((await test.recipient().runAlarm(test.fixture.sink))[0].outcome).toBe("daily-limit");
    expect(test.fixture.notifications).toHaveLength(3);
    await test.api(request("PUT", settings), "another-synthetic-character");
    test.fixture.advanceTo("2026-10-26T12:05:00Z");
    expect((await test.recipient().runAlarm(test.fixture.sink))[0].outcome).toBe("attempted");
    const queued = (await test.recipient().getSchedule()).find(
      (entry) => entry.characterId === characterId,
    );
    const off = await test.api(request("PUT", { ...settings, enabled: false }), characterId);
    expect(off.status).toBe(200);
    test.reopen();
    expect((await test.recipient().getCharacterSettings(characterId))?.enabled).toBe(false);
    expect(await test.recipient().handleAlarm(queued!, test.fixture.sink)).toBe("disabled");
    expect(test.fixture.notifications).toHaveLength(4);
  });

  it("認証なし・未確認characterは受信者storeを取得しない", async () => {
    const test = setup();
    test.authenticate.mockResolvedValueOnce(null);
    expect((await test.api(request(), characterId)).status).toBe(401);
    expect(test.verifyCharacter).not.toHaveBeenCalled();
    expect((await test.api(request(), "foreign-synthetic-character")).status).toBe(404);
    expect(test.getRecipient).not.toHaveBeenCalled();
    expect(test.fixture.storage.values.size).toBe(0);
  });

  it("client recipientIDや未知field・不正数値・同時刻静穏・壊れたJSONを拒否する", async () => {
    const test = setup();
    for (const body of [
      { ...settings, recipientId: "foreign-recipient" },
      { ...settings, dailyLimit: -1 },
      { ...settings, dailyLimit: Number.MAX_SAFE_INTEGER + 1 },
      { ...settings, idleMinutes: 0 },
      { ...settings, quietHours: { startMinute: 60, endMinute: 60 } },
      { ...settings, quietHours: { startMinute: 1440, endMinute: 0 } },
      "{broken-synthetic-json",
      "x".repeat(8193),
    ])
      expect((await test.api(request("PUT", body), characterId)).status).toBe(400);
    expect(test.getRecipient).not.toHaveBeenCalled();
    expect(test.fixture.storage.values.size).toBe(0);
  });

  it("cross-site更新・非JSON・未知methodを拒否し、許可はGET/PUTだけ", async () => {
    const test = setup();
    expect(
      (await test.api(request("PUT", settings, { origin: "http://foreign.test" }), characterId))
        .status,
    ).toBe(403);
    expect(
      (await test.api(request("PUT", settings, { "sec-fetch-site": "cross-site" }), characterId))
        .status,
    ).toBe(403);
    expect(
      (await test.api(request("PUT", settings, { "content-type": "text/plain" }), characterId))
        .status,
    ).toBe(415);
    const unsupported = await test.api(request("DELETE"), characterId);
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, PUT");
    expect(test.getRecipient).not.toHaveBeenCalled();
  });

  it("storage失敗の詳細は返さず、未確定settingsは保存しない", async () => {
    const test = setup();
    test.fixture.storage.failCommit = true;
    const response = await test.api(request("PUT", settings), characterId);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("synthetic commit failure");
    expect(test.fixture.storage.values.size).toBe(0);
  });

  it("activity controllerも確認済みcharacterだけを予定変更へ接続する", async () => {
    const test = setup();
    await test.api(request("PUT", settings), characterId);
    const controller = createProactiveNotificationController({
      ...test.dependencies,
      recipientId: "local",
    });
    test.fixture.advanceTo("2026-10-26T12:00:30Z");
    await controller.recordActivity(characterId);
    expect(test.fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T12:01:30Z"));
    const before = structuredClone(test.fixture.storage.values);
    await expect(controller.recordActivity("foreign-character")).rejects.toThrow();
    expect(test.fixture.storage.values).toEqual(before);
  });

  it("sink未設定も明示し、設定操作で通知自体を送らない", async () => {
    const test = setup();
    const api = createProactiveApi({ ...test.dependencies, deliveryMode: "unavailable" });
    const response = await api(request("PUT", settings), characterId);
    expect(proactiveStateSchema.parse(await response.json()).deliveryMode).toBe("unavailable");
    expect(test.fixture.notifications).toHaveLength(0);
  });

  it("同じactivityIdの受付再送は再起動後も予定を延長しない", async () => {
    const test = setup();
    await test.api(request("PUT", settings), characterId);
    test.fixture.advanceTo("2026-10-26T12:00:10Z");
    await test.recipient().recordActivity(characterId, "a".repeat(64));
    const before = structuredClone(test.fixture.storage.values);
    const alarmAt = test.fixture.storage.alarmAt;
    test.reopen();
    test.fixture.advanceTo("2026-10-26T12:00:40Z");
    await test.recipient().recordActivity(characterId, "a".repeat(64));
    expect(test.fixture.storage.values).toEqual(before);
    expect(test.fixture.storage.alarmAt).toBe(alarmAt);
    await test.recipient().recordActivity(characterId, "b".repeat(64));
    expect(test.fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T12:01:40Z"));
  });

  it("OFF中のactivityもdedupeし、ON後の再送で新activityにしない", async () => {
    const test = setup();
    await test.recipient().recordActivity(characterId, "c".repeat(64));
    test.fixture.advanceTo("2026-10-26T12:00:10Z");
    await test.api(request("PUT", settings), characterId);
    const before = structuredClone(test.fixture.storage.values);
    const alarmAt = test.fixture.storage.alarmAt;
    test.fixture.advanceTo("2026-10-26T12:00:40Z");
    await test.recipient().recordActivity(characterId, "c".repeat(64));
    expect(test.fixture.storage.values).toEqual(before);
    expect(test.fixture.storage.alarmAt).toBe(alarmAt);
  });

  it("activityとdedupeのcommit失敗は一緒にrollbackし、同IDを再試行できる", async () => {
    const test = setup();
    await test.api(request("PUT", settings), characterId);
    const before = structuredClone(test.fixture.storage.values);
    test.fixture.storage.failCommit = true;
    await expect(test.recipient().recordActivity(characterId, "d".repeat(64))).rejects.toThrow();
    expect(test.fixture.storage.values).toEqual(before);
    test.fixture.storage.failCommit = false;
    test.fixture.advanceTo("2026-10-26T12:00:20Z");
    await test.recipient().recordActivity(characterId, "d".repeat(64));
    expect(test.fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T12:01:20Z"));
  });
});
