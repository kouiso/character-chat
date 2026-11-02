import { ProactiveNotificationStore } from "../server/proactive-notification-store";

import type {
  ProactiveAlarm,
  ProactiveNotificationSink,
  ProactiveNotificationStorage,
  ProactiveNotificationTransaction,
} from "../server/proactive-notification-store";

export class FakeProactiveStorage implements ProactiveNotificationStorage {
  values = new Map<string, unknown>();
  alarmAt: number | null = null;
  failCommit = false;
  replayTransaction = false;
  beforeCommit: (() => Promise<void>) | undefined;

  async transaction<T>(
    closure: (transaction: ProactiveNotificationTransaction) => Promise<T>,
  ): Promise<T> {
    const run = async () => {
      const pending = structuredClone(this.values);
      let pendingAlarm = this.alarmAt;
      const result = await closure({
        get: <Value>(key: string) =>
          Promise.resolve(structuredClone(pending.get(key)) as Value | undefined),
        put: <Value>(key: string, value: Value) => {
          pending.set(key, structuredClone(value));
          return Promise.resolve();
        },
        setAlarm: (time: number) => {
          pendingAlarm = time;
          return Promise.resolve();
        },
        deleteAlarm: () => {
          pendingAlarm = null;
          return Promise.resolve();
        },
      });
      return { pending, pendingAlarm, result };
    };
    if (this.replayTransaction) await run();
    const { pending, pendingAlarm, result } = await run();
    await this.beforeCommit?.();
    if (this.failCommit) throw new Error("synthetic commit failure");
    this.values = pending;
    this.alarmAt = pendingAlarm;
    return result;
  }
}

export const createProactiveFixture = () => {
  const storage = new FakeProactiveStorage();
  let now = new Date("2026-10-26T12:00:00.000Z");
  const clock = () => new Date(now);
  const notifications: (ProactiveAlarm & { idempotencyKey: string })[] = [];
  const sink: ProactiveNotificationSink = {
    send: (notification) => {
      notifications.push(notification);
      return Promise.resolve();
    },
  };
  const open = (recipientId = "synthetic-recipient") =>
    new ProactiveNotificationStore({ recipientId, storage, clock });
  return {
    storage,
    sink,
    notifications,
    open,
    store: open(),
    alarm: (alarmId: string, characterId = "synthetic-character") => ({ alarmId, characterId }),
    advanceTo: (instant: string) => {
      now = new Date(instant);
    },
  };
};
