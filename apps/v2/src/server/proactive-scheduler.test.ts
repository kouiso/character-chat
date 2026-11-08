// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeProactiveStorage } from "../test/proactive-notification-fixture";

import { ProactiveScheduler } from "./proactive-scheduler";

import type { ProactiveAlarm, ProactiveNotificationSink } from "./proactive-notification-store";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const settings = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  dailyLimit: 2,
  idleMinutes: 60,
  quietHours: null,
  ...over,
});

const call = (scheduler: ProactiveScheduler, path: string, init: RequestInit = {}) =>
  scheduler.fetch(new Request(`https://proactive.internal${path}`, init));

const putSettings = (scheduler: ProactiveScheduler, characterId: string, body = settings()) =>
  call(scheduler, "/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId, settings: body }),
  });

const readSchedule = async (scheduler: ProactiveScheduler) => {
  const body: { schedule: { characterId: string; dueAt: number | null }[] } = await (
    await call(scheduler, "/schedule")
  ).json();
  return body.schedule;
};

describe("ProactiveScheduler DO", () => {
  let storage: FakeProactiveStorage;
  let now: Date;
  let notifications: (ProactiveAlarm & { idempotencyKey: string })[];
  let scheduler: ProactiveScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    now = new Date("2026-11-08T03:00:00.000Z");
    vi.setSystemTime(now);
    storage = new FakeProactiveStorage();
    notifications = [];
    const sink: ProactiveNotificationSink = {
      send: (n) => {
        notifications.push(n);
        return Promise.resolve();
      },
    };
    scheduler = new ProactiveScheduler(
      { storage } as unknown as DurableObjectState,
      {} as Cloudflare.Env,
      () => Promise.resolve(sink),
      () => new Date(now),
    );
  });
  afterEach(() => vi.useRealTimers());

  it("設定を保存して読み返せる。予定表にも載る", async () => {
    expect((await putSettings(scheduler, "char-1")).status).toBe(200);
    const res = await call(scheduler, "/settings?characterId=char-1");
    expect(await res.json()).toEqual({ settings: settings() });
    const schedule = await readSchedule(scheduler);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].dueAt).toBe(now.getTime() + 60 * 60_000);
  });

  it("発言すると予定が後ろへずれる", async () => {
    await putSettings(scheduler, "char-1");
    now = new Date(now.getTime() + 30 * 60_000);
    await call(scheduler, "/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "char-1" }),
    });
    const schedule = await readSchedule(scheduler);
    expect(schedule[0].dueAt).toBe(now.getTime() + 60 * 60_000);
  });

  it("OFF にしたら予定が消える", async () => {
    await putSettings(scheduler, "char-1");
    await call(scheduler, "/enabled", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId: "char-1", enabled: false }),
    });
    const schedule = await readSchedule(scheduler);
    expect(schedule[0].dueAt).toBeNull();
  });

  it("期限を迎えたら一言を送り、同じ alarm では二度送らん", async () => {
    await putSettings(scheduler, "char-1");
    now = new Date(now.getTime() + 61 * 60_000);
    await scheduler.alarm();
    expect(notifications).toHaveLength(1);
    await scheduler.alarm();
    // 二度目の alarm では次回予定が未来なので増えん。
    expect(notifications).toHaveLength(1);
    // 次回の期限を迎えたらもう一度送る。
    now = new Date(now.getTime() + 61 * 60_000);
    await scheduler.alarm();
    expect(notifications).toHaveLength(2);
    expect(notifications[0].idempotencyKey).not.toBe(notifications[1].idempotencyKey);
  });

  it("日またぎで上限が戻る", async () => {
    await putSettings(scheduler, "char-1", settings({ dailyLimit: 1 }));
    now = new Date(now.getTime() + 61 * 60_000);
    await scheduler.alarm();
    now = new Date(now.getTime() + 61 * 60_000);
    await scheduler.alarm();
    expect(notifications).toHaveLength(1);
    // 翌日(JST)を迎えたら再び送れる。
    now = new Date("2026-11-09T03:00:00.000Z");
    await scheduler.alarm();
    expect(notifications).toHaveLength(2);
  });
});
