// RIT-198: recall トリガの確かめ — idle と別系統の想起エントリが +24h で立ち、
// キュー有りなら送信・無しなら日次枠を消費せず見送ることを DO ストアで見る。
import { describe, expect, it } from "vitest";

import { createProactiveFixture as createFixture } from "../test/proactive-notification-fixture";

import type { ProactiveCharacterSettings } from "./proactive-notification-policy";
import type { ProactiveNotificationSink, ProactiveSchedule } from "./proactive-notification-store";

const characterId = "synthetic-character";
const settings = (
  overrides: Partial<ProactiveCharacterSettings> = {},
): ProactiveCharacterSettings => ({
  enabled: true,
  dailyLimit: 3,
  idleMinutes: 60,
  quietHours: null,
  ...overrides,
});

const sinkWithPreflight = (
  notifications: unknown[],
  verdict: "send" | "skip",
): ProactiveNotificationSink => ({
  send: (notification) => {
    notifications.push(notification);
    return Promise.resolve();
  },
  preflight: async (alarm) => (alarm.trigger === "recall" ? verdict : "send"),
});

const recallEntry = (entries: ProactiveSchedule[]) =>
  entries.filter((entry) => (entry.trigger ?? "idle") === "recall");

describe("RIT-198 memory-driven recall trigger", () => {
  it("configure で idle と recall の2本が立ち、recall は +24h", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings());
    const entries = await fixture.store.getSchedule();
    expect(entries).toHaveLength(2);
    const [recall] = recallEntry(entries);
    expect(recall.trigger).toBe("recall");
    expect(recall.dueAt).toBe(Date.parse("2026-10-27T12:00:00.000Z"));
    // ネイティブ alarm は直近の idle 発火時刻を指す。
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T13:00:00.000Z"));
  });

  it("キュー有りの recall は trigger=recall で送信され翌日へ進む", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings());
    fixture.advanceTo("2026-10-27T12:00:00.000Z");
    const results = await fixture.store.runAlarm(sinkWithPreflight(fixture.notifications, "send"));
    expect(results).toEqual([
      { characterId, outcome: "attempted" },
      { characterId, outcome: "attempted" },
    ]);
    const recallNotification = fixture.notifications.find(
      (notification) => notification.trigger === "recall",
    );
    expect(recallNotification).toBeTruthy();
    const [recall] = recallEntry(await fixture.store.getSchedule());
    expect(recall.dueAt).toBe(Date.parse("2026-10-28T12:00:00.000Z"));
  });

  it("キュー無しの recall は送信せず日次枠を消費しない", async () => {
    const fixture = createFixture();
    // dailyLimit=2: idle 1発 + recallスキップ後に idle がもう1発送れれば
    // recall が枠を食っていない証明になる。
    await fixture.store.configureCharacter(characterId, settings({ dailyLimit: 2 }));
    fixture.advanceTo("2026-10-27T12:00:00.000Z");
    const results = await fixture.store.runAlarm(sinkWithPreflight(fixture.notifications, "skip"));
    expect(results).toEqual([
      { characterId, outcome: "attempted" },
      { characterId, outcome: "no-recall-cue" },
    ]);
    expect(fixture.notifications).toHaveLength(1);
    // idle は +60min、recall は +24h。次の idle 発火で2枠目を正当に使う。
    fixture.advanceTo("2026-10-27T13:00:00.000Z");
    expect(await fixture.store.runAlarm(sinkWithPreflight(fixture.notifications, "skip"))).toEqual([
      { characterId, outcome: "attempted" },
    ]);
    fixture.advanceTo("2026-10-27T14:00:00.000Z");
    expect(await fixture.store.runAlarm(sinkWithPreflight(fixture.notifications, "skip"))).toEqual([
      { characterId, outcome: "daily-limit" },
    ]);
    expect(fixture.notifications).toHaveLength(2);
  });

  it("OFF では recall も立たず、再有効化で復活する", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings({ enabled: false }));
    expect(recallEntry(await fixture.store.getSchedule())[0].dueAt).toBeNull();
    await fixture.store.setCharacterEnabled(characterId, true);
    const [recall] = recallEntry(await fixture.store.getSchedule());
    expect(recall.dueAt).toBe(Date.parse("2026-10-27T12:00:00.000Z"));
  });

  it("送信失敗の recall は idle 間隔で粘り直す", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings());
    fixture.advanceTo("2026-10-27T12:00:00.000Z");
    const failingSink: ProactiveNotificationSink = {
      send: (notification) => {
        if (notification.trigger === "recall")
          return Promise.reject(new Error("synthetic recall failure"));
        fixture.notifications.push(notification);
        return Promise.resolve();
      },
      preflight: async () => "send",
    };
    await expect(fixture.store.runAlarm(failingSink)).rejects.toThrow("synthetic recall failure");
    const [recall] = recallEntry(await fixture.store.getSchedule());
    expect(recall.dueAt).toBe(Date.parse("2026-10-27T13:00:00.000Z"));
  });
});
