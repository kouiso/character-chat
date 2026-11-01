import { describe, expect, it } from "vitest";

import {
  createProactiveFixture as createFixture,
  FakeProactiveStorage,
} from "../test/proactive-notification-fixture";

import {
  nextProactiveAllowedTime,
  proactiveNotificationDay,
  validateProactiveSettings,
} from "./proactive-notification-policy";
import { ProactiveNotificationStore } from "./proactive-notification-store";

import type { ProactiveCharacterSettings } from "./proactive-notification-policy";
import type { ProactiveNotificationSink } from "./proactive-notification-store";

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

describe("RIT-95 opt-in, JST quiet time and durable alarm schedule", () => {
  it("stores explicit settings, remains silent for OFF, and schedules exactly after the idle interval", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings({ enabled: false }));
    expect(fixture.storage.alarmAt).toBeNull();
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([]);
    expect(await fixture.open().getCharacterSettings(characterId)).toEqual(
      settings({ enabled: false }),
    );
    await fixture.store.setCharacterEnabled(characterId, true);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T13:00:00.000Z"));
    fixture.advanceTo("2026-10-26T12:59:59.999Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([]);
    fixture.advanceTo("2026-10-26T13:00:00.000Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
      { characterId, outcome: "attempted" },
    ]);
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T14:00:00.000Z"));
  });

  it("defers a crossing-midnight quiet interval to 07:00 JST regardless of host timezone", async () => {
    const fixture = createFixture();
    fixture.advanceTo("2026-10-26T12:30:00.000Z");
    await fixture.store.configureCharacter(
      characterId,
      settings({ quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 } }),
    );
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T22:00:00.000Z"));
    fixture.advanceTo("2026-10-26T21:59:59.999Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([]);
    fixture.advanceTo("2026-10-26T22:00:00.000Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
      { characterId, outcome: "attempted" },
    ]);
    expect(fixture.notifications).toHaveLength(1);
  });

  it("uses half-open quiet boundaries including a daytime interval", () => {
    const quiet = { startMinute: 12 * 60, endMinute: 13 * 60 };
    for (const [instant, expected] of [
      ["2026-10-26T02:59:59.999Z", "2026-10-26T02:59:59.999Z"],
      ["2026-10-26T03:00:00.000Z", "2026-10-26T04:00:00.000Z"],
      ["2026-10-26T03:59:59.999Z", "2026-10-26T04:00:00.000Z"],
      ["2026-10-26T04:00:00.000Z", "2026-10-26T04:00:00.000Z"],
    ])
      expect(nextProactiveAllowedTime(Date.parse(instant), quiet)).toBe(Date.parse(expected));
    expect(proactiveNotificationDay(new Date("2026-10-26T14:59:59.999Z"))).toBe("2026-10-26");
    expect(proactiveNotificationDay(new Date("2026-10-26T15:00:00.000Z"))).toBe("2026-10-27");
  });

  it("sends no fourth notification and advances the next alarm to the next JST day", async () => {
    const fixture = createFixture();
    fixture.advanceTo("2026-10-26T00:00:00.000Z");
    await fixture.store.configureCharacter(characterId, settings());
    for (let hour = 1; hour <= 3; hour++) {
      fixture.advanceTo(`2026-10-26T0${hour}:00:00.000Z`);
      expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
        { characterId, outcome: "attempted" },
      ]);
    }
    fixture.advanceTo("2026-10-26T04:00:00.000Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
      { characterId, outcome: "daily-limit" },
    ]);
    expect(fixture.notifications).toHaveLength(3);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T15:00:00.000Z"));
    fixture.advanceTo("2026-10-26T15:00:00.000Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
      { characterId, outcome: "attempted" },
    ]);
    expect(fixture.notifications).toHaveLength(4);
  });

  it("moves the schedule after activity and invalidates the old occurrence without consuming quota", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings({ dailyLimit: 1 }));
    const [old] = await fixture.store.getSchedule();
    fixture.advanceTo("2026-10-26T12:30:00.000Z");
    await fixture.store.recordActivity(characterId);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T13:30:00.000Z"));
    fixture.advanceTo("2026-10-26T13:30:00.000Z");
    expect(await fixture.store.handleAlarm(old, fixture.sink)).toBe("stale-alarm");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
      { characterId, outcome: "attempted" },
    ]);
    expect(fixture.notifications).toHaveLength(1);
  });

  it("cancels OFF schedules, keeps other characters' next alarm, and does not revive an old occurrence on re-enable", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings());
    const [old] = await fixture.store.getSchedule();
    await fixture.store.configureCharacter(
      "other-synthetic-character",
      settings({ idleMinutes: 120 }),
    );
    await fixture.store.setCharacterEnabled(characterId, false);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T14:00:00.000Z"));
    fixture.advanceTo("2026-10-26T13:00:00.000Z");
    expect(await fixture.open().runAlarm(fixture.sink)).toEqual([]);
    await fixture.store.setCharacterEnabled(characterId, true);
    fixture.advanceTo("2026-10-26T14:00:00.000Z");
    expect(await fixture.store.handleAlarm(old, fixture.sink)).toBe("stale-alarm");
    await fixture.store.runAlarm(fixture.sink);
    expect(fixture.notifications).toHaveLength(2);
    await fixture.store.setCharacterEnabled(characterId, false);
    await fixture.store.setCharacterEnabled("other-synthetic-character", false);
    expect(fixture.storage.alarmAt).toBeNull();
  });

  it("rechecks quiet settings and rejects a stale plan following a settings update", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings());
    const [old] = await fixture.store.getSchedule();
    await fixture.store.configureCharacter(
      characterId,
      settings({ quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 } }),
    );
    fixture.advanceTo("2026-10-26T13:00:00.000Z");
    expect(await fixture.store.handleAlarm(old, fixture.sink)).toBe("quiet-hours");
    expect(fixture.notifications).toHaveLength(0);
  });

  it("keeps one sink notification when runAlarm is retried twice after send failure", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings());
    fixture.advanceTo("2026-10-26T13:00:00.000Z");
    const failingSink: ProactiveNotificationSink = {
      send: (notification) => {
        fixture.notifications.push(notification);
        return Promise.reject(new Error("synthetic failure after sink"));
      },
    };
    await expect(fixture.store.runAlarm(failingSink)).rejects.toThrow("after sink");
    expect(await fixture.open().runAlarm(failingSink)).toEqual([]);
    expect(await fixture.open().runAlarm(failingSink)).toEqual([]);
    expect(fixture.notifications).toHaveLength(1);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T14:00:00.000Z"));
  });

  it("reconstructs settings, activity and schedules from persisted state", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings({ idleMinutes: 30 }));
    fixture.advanceTo("2026-10-26T12:15:00.000Z");
    await fixture.store.recordActivity(characterId);
    const storage = new FakeProactiveStorage();
    storage.values = structuredClone(fixture.storage.values);
    storage.alarmAt = fixture.storage.alarmAt;
    const restarted = new ProactiveNotificationStore({
      recipientId: "synthetic-recipient",
      storage,
      clock: () => new Date("2026-10-26T12:45:00.000Z"),
    });
    expect(await restarted.getCharacterSettings(characterId)).toEqual(
      settings({ idleMinutes: 30 }),
    );
    expect(await restarted.runAlarm(fixture.sink)).toEqual([{ characterId, outcome: "attempted" }]);
    expect(fixture.notifications).toHaveLength(1);
  });

  it("rearms every character even when many simultaneous sends fail after the side effect", async () => {
    const fixture = createFixture();
    for (let index = 0; index < 8; index++)
      await fixture.store.configureCharacter(`synthetic-${index}`, settings());
    fixture.advanceTo("2026-10-26T13:00:00.000Z");
    const failingSink: ProactiveNotificationSink = {
      send: (notification) => {
        fixture.notifications.push(notification);
        return Promise.reject(new Error("synthetic sink failure"));
      },
    };
    await expect(fixture.store.runAlarm(failingSink)).rejects.toThrow("sink failure");
    expect(fixture.notifications).toHaveLength(8);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T14:00:00.000Z"));
    expect(await fixture.open().runAlarm(failingSink)).toEqual([]);
    expect(await fixture.open().runAlarm(failingSink)).toEqual([]);
    expect(fixture.notifications).toHaveLength(8);
  });

  it("uses the character's explicit limit instead of the clearly named fallback default", async () => {
    const fixture = createFixture();
    await fixture.store.setDefaultDailyLimit(0);
    await fixture.store.configureCharacter(characterId, settings({ dailyLimit: 1 }));
    fixture.advanceTo("2026-10-26T13:00:00.000Z");
    await fixture.store.runAlarm(fixture.sink);
    fixture.advanceTo("2026-10-26T14:00:00.000Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
      { characterId, outcome: "daily-limit" },
    ]);
    expect(fixture.notifications).toHaveLength(1);
  });

  it("rolls back both settings and the native alarm schedule if configure cannot commit", async () => {
    const fixture = createFixture();
    await fixture.store.configureCharacter(characterId, settings());
    const previous = await fixture.store.getSchedule();
    const alarmAt = fixture.storage.alarmAt;
    fixture.storage.failCommit = true;
    await expect(
      fixture.store.configureCharacter(characterId, settings({ idleMinutes: 120 })),
    ).rejects.toThrow("commit failure");
    fixture.storage.failCommit = false;
    expect(await fixture.store.getSchedule()).toEqual(previous);
    expect(fixture.storage.alarmAt).toBe(alarmAt);
    expect(await fixture.store.getCharacterSettings(characterId)).toEqual(settings());
  });

  it("suppresses an old-day reservation if commit crosses JST midnight", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled(characterId, true);
    fixture.advanceTo("2026-10-26T14:59:59.999Z");
    fixture.storage.beforeCommit = () => {
      fixture.advanceTo("2026-10-26T15:00:00.000Z");
      fixture.storage.beforeCommit = undefined;
      return Promise.resolve();
    };
    expect(await fixture.store.handleAlarm(fixture.alarm("crossing"), fixture.sink)).toBe(
      "expired-window",
    );
    for (const id of ["a", "b", "c"])
      await fixture.store.handleAlarm(fixture.alarm(id), fixture.sink);
    expect(await fixture.store.handleAlarm(fixture.alarm("d"), fixture.sink)).toBe("daily-limit");
    expect(fixture.notifications).toHaveLength(3);
  });

  it.each([2, 3, 4])(
    "keeps the new JST day's quota usable when transaction %i crosses midnight after a daily-limit decision",
    async (crossingCommit) => {
      const fixture = createFixture();
      fixture.advanceTo("2026-10-26T00:00:00.000Z");
      await fixture.store.configureCharacter(characterId, settings());
      for (let hour = 1; hour <= 3; hour++) {
        fixture.advanceTo(`2026-10-26T0${hour}:00:00.000Z`);
        await fixture.store.runAlarm(fixture.sink);
      }
      fixture.advanceTo("2026-10-26T14:59:59.999Z");
      let commits = 0;
      fixture.storage.beforeCommit = () => {
        if (++commits === crossingCommit) {
          fixture.advanceTo("2026-10-26T15:00:00.000Z");
          fixture.storage.beforeCommit = undefined;
        }
        return Promise.resolve();
      };
      expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
        { characterId, outcome: "daily-limit" },
      ]);
      expect(fixture.notifications).toHaveLength(3);
      const nextAt = fixture.storage.alarmAt;
      expect(nextAt).not.toBeNull();
      expect(nextAt).toBeGreaterThanOrEqual(Date.parse("2026-10-26T15:00:00.000Z"));
      expect(nextAt).toBeLessThanOrEqual(Date.parse("2026-10-26T16:00:00.000Z"));
      fixture.advanceTo(new Date(nextAt ?? 0).toISOString());
      expect(await fixture.open().runAlarm(fixture.sink)).toEqual([
        { characterId, outcome: "attempted" },
      ]);
      expect(fixture.notifications).toHaveLength(4);
    },
  );

  it("keeps the exact next JST midnight when a late daily-limit decision needs no additional idle interval", async () => {
    const fixture = createFixture();
    fixture.advanceTo("2026-10-26T00:00:00.000Z");
    await fixture.store.configureCharacter(characterId, settings());
    for (let hour = 1; hour <= 3; hour++) {
      fixture.advanceTo(`2026-10-26T0${hour}:00:00.000Z`);
      await fixture.store.runAlarm(fixture.sink);
    }
    fixture.advanceTo("2026-10-26T14:30:00.000Z");
    expect(await fixture.store.runAlarm(fixture.sink)).toEqual([
      { characterId, outcome: "daily-limit" },
    ]);
    expect(fixture.storage.alarmAt).toBe(Date.parse("2026-10-26T15:00:00.000Z"));
    expect(fixture.notifications).toHaveLength(3);
  });

  it("suppresses a notification if quiet time begins during reservation commit", async () => {
    const fixture = createFixture();
    fixture.advanceTo("2026-10-26T11:59:59.999Z");
    await fixture.store.configureCharacter(
      characterId,
      settings({ quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 } }),
    );
    const [entry] = await fixture.store.getSchedule();
    fixture.advanceTo("2026-10-26T12:59:59.999Z");
    fixture.storage.beforeCommit = () => {
      fixture.advanceTo("2026-10-26T13:00:00.000Z");
      fixture.storage.beforeCommit = undefined;
      return Promise.resolve();
    };
    expect(await fixture.store.handleAlarm(entry, fixture.sink)).toBe("quiet-hours");
    expect(fixture.notifications).toHaveLength(0);
  });

  it("validates settings and never schedules invalid intervals or ambiguous equal quiet endpoints", async () => {
    const fixture = createFixture();
    for (const invalid of [
      settings({ dailyLimit: -1 }),
      settings({ idleMinutes: 0 }),
      settings({ idleMinutes: Number.NaN }),
      settings({ quietHours: { startMinute: 60, endMinute: 60 } }),
      settings({ quietHours: { startMinute: -1, endMinute: 60 } }),
      settings({ quietHours: { startMinute: 0, endMinute: 1440 } }),
    ]) {
      expect(() => fixture.store.configureCharacter(characterId, invalid)).toThrow(RangeError);
    }
    expect(validateProactiveSettings(settings())).toEqual(settings());
    expect(fixture.storage.alarmAt).toBeNull();
    expect(fixture.storage.values.size).toBe(0);
    expect(await fixture.store.getCharacterSettings(characterId)).toBeUndefined();
  });
});
