import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createProactiveFixture as createFixture,
  FakeProactiveStorage as FakeStorage,
} from "../test/proactive-notification-fixture";

import { ProactiveNotificationStore } from "./proactive-notification-store";

import type {
  ProactiveNotificationSink,
  ProactiveNotificationStorage,
} from "./proactive-notification-store";

describe("proactive notification alarm policy and durable store", () => {
  it("accepts the native Durable Object storage transaction interface", () => {
    expectTypeOf<DurableObjectStorage>().toMatchTypeOf<ProactiveNotificationStorage>();
  });

  it("defaults to OFF and sends zero notifications", async () => {
    const fixture = createFixture();
    expect(await fixture.store.handleAlarm(fixture.alarm("a"), fixture.sink)).toBe("disabled");
    expect(fixture.notifications).toHaveLength(0);
    expect(fixture.storage.values.size).toBe(0);
  });

  it("sends three notifications and blocks the fourth with a daily limit of three", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    await fixture.store.setDefaultDailyLimit(3);
    const outcomes = await Promise.all(
      ["a", "b", "c", "d"].map((id) => fixture.store.handleAlarm(fixture.alarm(id), fixture.sink)),
    );
    expect(outcomes).toEqual(["attempted", "attempted", "attempted", "daily-limit"]);
    expect(fixture.notifications.map((notification) => notification.alarmId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps each character's cap and each recipient isolated", async () => {
    const fixture = createFixture();
    const other = fixture.open("another-synthetic-recipient");
    for (const store of [fixture.store, other]) {
      await store.setCharacterEnabled("synthetic-character", true);
      await store.setCharacterEnabled("another-synthetic-character", true);
    }
    for (const id of ["a", "b", "c"]) {
      await fixture.store.handleAlarm(fixture.alarm(id), fixture.sink);
    }
    expect(
      await fixture.store.handleAlarm(
        fixture.alarm("d", "another-synthetic-character"),
        fixture.sink,
      ),
    ).toBe("attempted");
    expect(await other.handleAlarm(fixture.alarm("a"), fixture.sink)).toBe("attempted");
    expect(
      new Set(fixture.notifications.map((notification) => notification.idempotencyKey)).size,
    ).toBe(5);
  });

  it("sends zero after OFF, including queued alarms, retries and a reopened store", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    await fixture.store.handleAlarm(fixture.alarm("before-off"), fixture.sink);
    await fixture.store.setCharacterEnabled("synthetic-character", false);
    fixture.notifications.length = 0;
    const outcomes = await Promise.all(
      ["queued", "retry", "retry"].map((id) =>
        fixture.open().handleAlarm(fixture.alarm(id), fixture.sink),
      ),
    );
    expect(outcomes).toEqual(["disabled", "disabled", "disabled"]);
    expect(fixture.notifications).toHaveLength(0);
  });

  it("waits for an in-flight send before OFF completes and blocks a subsequent alarm", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    let finishSend: () => void = () => {
      throw new Error("send has not started");
    };
    let startedSend: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      startedSend = resolve;
    });
    const slowSink: ProactiveNotificationSink = {
      send: async (notification) => {
        fixture.notifications.push(notification);
        startedSend();
        await new Promise<void>((resolve) => {
          finishSend = resolve;
        });
      },
    };
    const sending = fixture.store.handleAlarm(fixture.alarm("in-flight"), slowSink);
    await started;
    let offCompleted = false;
    const disabling = fixture
      .open()
      .setCharacterEnabled("synthetic-character", false)
      .then(() => {
        offCompleted = true;
      });
    const next = fixture.open().handleAlarm(fixture.alarm("after-off"), fixture.sink);
    await Promise.resolve();
    expect(offCompleted).toBe(false);
    finishSend();
    await Promise.all([sending, disabling]);
    expect(await next).toBe("disabled");
    expect(fixture.notifications).toHaveLength(1);
  });

  it("keeps one notification when the alarm fails after sending and is retried twice", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    const alarm = fixture.alarm("stable-occurrence-id");
    const failingSink: ProactiveNotificationSink = {
      send: (notification) => {
        fixture.notifications.push(notification);
        return Promise.reject(new Error("synthetic alarm failure after send"));
      },
    };
    await expect(fixture.store.handleAlarm(alarm, failingSink)).rejects.toThrow("after send");
    for (let retry = 0; retry < 2; retry++) {
      expect(await fixture.open().handleAlarm(alarm, failingSink)).toBe("duplicate");
    }
    expect(fixture.notifications).toHaveLength(1);
  });

  it("deduplicates concurrent deliveries from multiple store instances", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () =>
        fixture.open().handleAlarm(fixture.alarm("same"), fixture.sink),
      ),
    );
    expect(outcomes).toEqual(["attempted", "duplicate", "duplicate"]);
    expect(fixture.notifications).toHaveLength(1);
  });

  it("keeps counters on restart and resets at JST midnight without forgetting old alarm IDs", async () => {
    const fixture = createFixture();
    fixture.advanceTo("2026-10-26T14:59:59.999Z");
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    for (const id of ["a", "b", "c"]) {
      await fixture.open().handleAlarm(fixture.alarm(id), fixture.sink);
    }
    expect(await fixture.open().handleAlarm(fixture.alarm("d"), fixture.sink)).toBe("daily-limit");
    fixture.advanceTo("2026-10-26T15:00:00.000Z");
    expect(await fixture.open().handleAlarm(fixture.alarm("a"), fixture.sink)).toBe("duplicate");
    expect(await fixture.open().handleAlarm(fixture.alarm("d"), fixture.sink)).toBe("attempted");
    expect(fixture.notifications).toHaveLength(4);
    fixture.advanceTo("2026-10-26T14:59:59.999Z");
    expect(await fixture.open().handleAlarm(fixture.alarm("e"), fixture.sink)).toBe("daily-limit");
  });

  it("preserves quota and deduplication across OFF/ON", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    await fixture.store.setDefaultDailyLimit(1);
    await fixture.store.handleAlarm(fixture.alarm("a"), fixture.sink);
    await fixture.store.setCharacterEnabled("synthetic-character", false);
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    expect(await fixture.store.handleAlarm(fixture.alarm("a"), fixture.sink)).toBe("duplicate");
    expect(await fixture.store.handleAlarm(fixture.alarm("b"), fixture.sink)).toBe("daily-limit");
    expect(fixture.notifications).toHaveLength(1);
  });

  it("retains settings, quota and receipts with a reconstructed storage binding", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    await fixture.store.setDefaultDailyLimit(1);
    await fixture.store.handleAlarm(fixture.alarm("persisted"), fixture.sink);
    const storage = new FakeStorage();
    storage.values = structuredClone(fixture.storage.values);
    const restarted = new ProactiveNotificationStore({
      recipientId: "synthetic-recipient",
      storage,
      clock: () => new Date("2026-10-26T13:00:00.000Z"),
    });
    expect(await restarted.handleAlarm(fixture.alarm("persisted"), fixture.sink)).toBe("duplicate");
    expect(await restarted.handleAlarm(fixture.alarm("new"), fixture.sink)).toBe("daily-limit");
    expect(fixture.notifications).toHaveLength(1);
  });

  it("never sends if the reservation commit fails, and safely retries the whole transaction", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    await fixture.store.setDefaultDailyLimit(1);
    fixture.storage.failCommit = true;
    await expect(fixture.store.handleAlarm(fixture.alarm("a"), fixture.sink)).rejects.toThrow(
      "commit failure",
    );
    expect(fixture.notifications).toHaveLength(0);
    fixture.storage.failCommit = false;
    fixture.storage.replayTransaction = true;
    expect(await fixture.store.handleAlarm(fixture.alarm("a"), fixture.sink)).toBe("attempted");
    expect(await fixture.store.handleAlarm(fixture.alarm("b"), fixture.sink)).toBe("daily-limit");
    expect(fixture.notifications).toHaveLength(1);
  });

  it("does not reclaim an uncertain send or retry a failure before the sink side effect", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    await fixture.store.setDefaultDailyLimit(1);
    let attempts = 0;
    const failingSink: ProactiveNotificationSink = {
      send: () => {
        attempts++;
        return Promise.reject(new Error("synthetic sink unavailable"));
      },
    };
    await expect(fixture.store.handleAlarm(fixture.alarm("a"), failingSink)).rejects.toThrow(
      "unavailable",
    );
    expect(await fixture.store.handleAlarm(fixture.alarm("a"), failingSink)).toBe("duplicate");
    expect(await fixture.store.handleAlarm(fixture.alarm("b"), fixture.sink)).toBe("daily-limit");
    expect(attempts).toBe(1);
    expect(fixture.notifications).toHaveLength(0);
  });

  it("supports a zero limit and rejects invalid identifiers and limits before sending", async () => {
    const fixture = createFixture();
    await fixture.store.setCharacterEnabled("synthetic-character", true);
    await fixture.store.setDefaultDailyLimit(0);
    expect(await fixture.store.handleAlarm(fixture.alarm("a"), fixture.sink)).toBe("daily-limit");
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => fixture.store.setDefaultDailyLimit(limit)).toThrow(RangeError);
    }
    expect(() => fixture.store.handleAlarm(fixture.alarm(""), fixture.sink)).toThrow(RangeError);
    expect(() => fixture.store.setCharacterEnabled(" ", true)).toThrow(RangeError);
    expect(() => fixture.open("x".repeat(257))).toThrow(RangeError);
    expect(() => fixture.open("あ".repeat(100))).toThrow(RangeError);
    expect(fixture.notifications).toHaveLength(0);
  });
});
