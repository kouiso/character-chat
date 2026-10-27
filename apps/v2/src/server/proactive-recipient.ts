import { DurableObject } from "cloudflare:workers";

import { ProactiveNotificationStore } from "./proactive-notification-store";

import type { ProactiveCharacterSettings } from "./proactive-notification-policy";

type MockNotification = { alarmId: string; characterId: string; idempotencyKey: string };

// 会話返信のalarmと通知予定を同じDOへ置くと、互いの予定を上書きしてしまう。
export class ProactiveRecipient extends DurableObject<Cloudflare.Env> {
  private testNow: number | undefined;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.testNow = await ctx.storage.get<number>("test:now");
    });
  }

  private mockEnabled(): boolean {
    return this.env.APP_ENV === "test" && this.env.V2_PROACTIVE_MOCK === "1";
  }

  private store(): ProactiveNotificationStore {
    return new ProactiveNotificationStore({
      recipientId: "local",
      storage: this.ctx.storage,
      clock: () =>
        new Date(this.mockEnabled() && this.testNow !== undefined ? this.testNow : Date.now()),
    });
  }

  getCharacterSettings(characterId: string) {
    return this.store().getCharacterSettings(characterId);
  }
  getCharacterState(characterId: string) {
    return this.store().getCharacterState(characterId);
  }
  getSchedule() {
    return this.store().getSchedule();
  }

  async configureCharacter(
    characterId: string,
    settings: ProactiveCharacterSettings,
  ): Promise<void> {
    if (settings.enabled && !this.mockEnabled())
      throw new Error("Notification delivery is unavailable");
    await this.store().configureCharacter(characterId, settings);
  }

  recordActivity(characterId: string, activityId?: string): Promise<void> {
    return this.store().recordActivity(characterId, activityId);
  }

  async alarm(): Promise<void> {
    if (!this.mockEnabled()) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.store().runAlarm({
      send: async (notification) => {
        await this.ctx.storage.put(
          `mock:notification:${notification.idempotencyKey}`,
          notification,
        );
      },
    });
  }

  // 合成検証専用の時計とsink読取。通常環境ではRPCも利用不可にする。
  async setMockTime(time: number): Promise<void> {
    if (!this.mockEnabled() || !Number.isSafeInteger(time) || time < 0)
      throw new Error("Mock clock is unavailable");
    await this.ctx.storage.put("test:now", time);
    this.testNow = time;
  }

  async readMockNotifications(): Promise<MockNotification[]> {
    if (!this.mockEnabled()) throw new Error("Mock sink is unavailable");
    return [
      ...(await this.ctx.storage.list<MockNotification>({ prefix: "mock:notification:" })).values(),
    ];
  }

  async runMockAlarm(): Promise<void> {
    if (!this.mockEnabled()) throw new Error("Mock alarm is unavailable");
    await this.alarm();
  }
}
