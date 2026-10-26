import {
  DEFAULT_PROACTIVE_DAILY_LIMIT,
  evaluateProactiveNotification,
  proactiveNotificationDay,
} from "./proactive-notification-policy";

import type { ProactiveNotificationDecision } from "./proactive-notification-policy";

export type ProactiveNotificationTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

export type ProactiveNotificationStorage = {
  transaction<T>(
    closure: (transaction: ProactiveNotificationTransaction) => Promise<T>,
  ): Promise<T>;
};

export type ProactiveAlarm = {
  alarmId: string;
  characterId: string;
};

export type ProactiveNotificationSink = {
  send(notification: ProactiveAlarm & { idempotencyKey: string }): Promise<void>;
};

type Reservation = { day: string; characterId: string };

// OFF 完了後に、同じ storage を使う別インスタンスの送信も始まらんよう直列化する。
const storageTails = new WeakMap<ProactiveNotificationStorage, Promise<void>>();

const validateId = (id: string): string => {
  if (id.trim().length === 0 || id.length > 256) throw new RangeError("Invalid proactive ID");
  const encoded = encodeURIComponent(id);
  if (encoded.length > 512) throw new RangeError("Invalid proactive ID");
  return encoded;
};

export class ProactiveNotificationStore {
  private readonly prefix: string;
  private readonly storage: ProactiveNotificationStorage;
  private readonly clock: () => Date;

  constructor(input: {
    recipientId: string;
    storage: ProactiveNotificationStorage;
    clock?: () => Date;
  }) {
    this.prefix = `proactive:v1:${validateId(input.recipientId)}`;
    this.storage = input.storage;
    this.clock = input.clock ?? (() => new Date());
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = (storageTails.get(this.storage) ?? Promise.resolve()).then(operation);
    storageTails.set(
      this.storage,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  setCharacterEnabled(characterId: string, enabled: boolean): Promise<void> {
    const key = `${this.prefix}:enabled:${validateId(characterId)}`;
    return this.serialize(() =>
      this.storage.transaction((transaction) => transaction.put(key, enabled)),
    );
  }

  setDailyLimit(limit: number): Promise<void> {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError("Invalid proactive daily limit");
    return this.serialize(() =>
      this.storage.transaction((transaction) => transaction.put(`${this.prefix}:limit`, limit)),
    );
  }

  handleAlarm(
    alarm: ProactiveAlarm,
    sink: ProactiveNotificationSink,
  ): Promise<Exclude<ProactiveNotificationDecision, "allowed"> | "attempted"> {
    const occurrence = { ...alarm };
    const characterId = validateId(occurrence.characterId);
    const alarmId = validateId(occurrence.alarmId);
    const reservationKey = `${this.prefix}:alarm:${alarmId}`;

    return this.serialize(async () => {
      const day = proactiveNotificationDay(this.clock());
      const counterKey = `${this.prefix}:day:${day}`;
      const decision = await this.storage.transaction(async (transaction) => {
        const enabled =
          (await transaction.get<boolean>(`${this.prefix}:enabled:${characterId}`)) ?? false;
        const dailyLimit =
          (await transaction.get<number>(`${this.prefix}:limit`)) ?? DEFAULT_PROACTIVE_DAILY_LIMIT;
        const reservedToday = (await transaction.get<number>(counterKey)) ?? 0;
        const alreadyReserved = (await transaction.get<Reservation>(reservationKey)) !== undefined;
        const result = evaluateProactiveNotification({
          enabled,
          dailyLimit,
          reservedToday,
          alreadyReserved,
        });
        if (result !== "allowed") return result;

        // 送信成功直後に alarm が落ちても、再試行から同じ通知を送らんため先に確定する。
        await transaction.put(reservationKey, { day, characterId: occurrence.characterId });
        await transaction.put(counterKey, reservedToday + 1);
        return result;
      });
      if (decision !== "allowed") return decision;

      // 送信先の結果が不明でも予約を戻さず、重複防止と上限を優先する。
      await sink.send({ ...occurrence, idempotencyKey: reservationKey });
      return "attempted";
    });
  }
}
