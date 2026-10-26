import {
  DEFAULT_PROACTIVE_DAILY_LIMIT,
  evaluateProactiveNotification,
  isProactiveQuietTime,
  nextJapanMidnight,
  nextProactiveAllowedTime,
  proactiveNotificationDay,
  validateProactiveSettings,
} from "./proactive-notification-policy";

import type {
  ProactiveCharacterSettings,
  ProactiveNotificationDecision,
} from "./proactive-notification-policy";

export type ProactiveNotificationTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
};

export type ProactiveNotificationStorage = {
  transaction<T>(
    closure: (transaction: ProactiveNotificationTransaction) => Promise<T>,
  ): Promise<T>;
};

export type ProactiveAlarm = { alarmId: string; characterId: string };
export type ProactiveNotificationSink = {
  send(notification: ProactiveAlarm & { idempotencyKey: string }): Promise<void>;
};
export type ProactiveSchedule = ProactiveAlarm & { dueAt: number | null };
export type ProactiveAlarmOutcome =
  | Exclude<ProactiveNotificationDecision, "allowed">
  | "attempted"
  | "send-failed";
type ScheduleState = { sequence: number; entries: ProactiveSchedule[] };
type Reservation = { day: string; characterId: string };

// OFF 完了後に、同じ storage を使う別インスタンスの送信も始まらんよう直列化する。
const storageTails = new WeakMap<ProactiveNotificationStorage, Promise<void>>();
const MINUTE_MS = 60_000;

class ProactiveNotificationSendError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Proactive notification sink failed", { cause });
  }
}

const validateId = (id: string): string => {
  if (id.trim().length === 0 || id.length > 256) throw new RangeError("Invalid proactive ID");
  const encoded = encodeURIComponent(id);
  if (encoded.length > 512) throw new RangeError("Invalid proactive ID");
  return encoded;
};

const validTime = (time: number): number => {
  if (!Number.isFinite(new Date(time).getTime())) throw new RangeError("Invalid proactive time");
  return time;
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
    this.prefix = `proactive:v2:${validateId(input.recipientId)}`;
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

  private settingsKey(characterId: string): string {
    return `${this.prefix}:settings:${validateId(characterId)}`;
  }

  private async readSchedule(
    transaction: ProactiveNotificationTransaction,
  ): Promise<ScheduleState> {
    return (
      (await transaction.get<ScheduleState>(`${this.prefix}:schedule`)) ?? {
        sequence: 0,
        entries: [],
      }
    );
  }

  private async writeSchedule(
    transaction: ProactiveNotificationTransaction,
    state: ScheduleState,
  ): Promise<void> {
    await transaction.put(`${this.prefix}:schedule`, state);
    const times = state.entries.flatMap((entry) => (entry.dueAt === null ? [] : [entry.dueAt]));
    if (times.length) await transaction.setAlarm(Math.min(...times));
    else await transaction.deleteAlarm();
  }

  private replaceSchedule(state: ScheduleState, characterId: string, dueAt: number | null): void {
    if (!Number.isSafeInteger(state.sequence + 1))
      throw new RangeError("Proactive schedule exhausted");
    state.sequence++;
    const entry = {
      characterId,
      alarmId: `scheduled-${state.sequence}`,
      dueAt: dueAt === null ? null : validTime(dueAt),
    };
    const index = state.entries.findIndex((candidate) => candidate.characterId === characterId);
    if (index === -1) state.entries.push(entry);
    else state.entries[index] = entry;
  }

  configureCharacter(characterId: string, settings: ProactiveCharacterSettings): Promise<void> {
    const settingsKey = this.settingsKey(characterId);
    const snapshot = validateProactiveSettings(settings);
    return this.serialize(() =>
      this.storage.transaction(async (transaction) => {
        const now = validTime(this.clock().getTime());
        const state = await this.readSchedule(transaction);
        const lastActivityAt = (await transaction.get<number>(`${settingsKey}:activity`)) ?? now;
        const dueAt = snapshot.enabled
          ? nextProactiveAllowedTime(
              Math.max(now, lastActivityAt) + snapshot.idleMinutes * MINUTE_MS,
              snapshot.quietHours,
            )
          : null;
        this.replaceSchedule(state, characterId, dueAt);
        await transaction.put(settingsKey, snapshot);
        await transaction.put(
          `${this.prefix}:enabled:${validateId(characterId)}`,
          snapshot.enabled,
        );
        await transaction.put(`${settingsKey}:activity`, lastActivityAt);
        await this.writeSchedule(transaction, state);
      }),
    );
  }

  getCharacterSettings(characterId: string): Promise<ProactiveCharacterSettings | undefined> {
    const key = this.settingsKey(characterId);
    return this.serialize(() =>
      this.storage.transaction((transaction) => transaction.get<ProactiveCharacterSettings>(key)),
    );
  }

  getSchedule(): Promise<ProactiveSchedule[]> {
    return this.serialize(() =>
      this.storage.transaction(
        async (transaction) => (await this.readSchedule(transaction)).entries,
      ),
    );
  }

  setCharacterEnabled(characterId: string, enabled: boolean): Promise<void> {
    const settingsKey = this.settingsKey(characterId);
    if (typeof enabled !== "boolean") throw new RangeError("Invalid proactive opt-in");
    return this.serialize(() =>
      this.storage.transaction(async (transaction) => {
        await transaction.put(`${this.prefix}:enabled:${validateId(characterId)}`, enabled);
        const settings = await transaction.get<ProactiveCharacterSettings>(settingsKey);
        if (!settings) return;
        const state = await this.readSchedule(transaction);
        const now = validTime(this.clock().getTime());
        this.replaceSchedule(
          state,
          characterId,
          enabled
            ? nextProactiveAllowedTime(now + settings.idleMinutes * MINUTE_MS, settings.quietHours)
            : null,
        );
        await transaction.put(settingsKey, { ...settings, enabled });
        await this.writeSchedule(transaction, state);
      }),
    );
  }

  setDefaultDailyLimit(limit: number): Promise<void> {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError("Invalid proactive daily limit");
    return this.serialize(() =>
      this.storage.transaction((transaction) => transaction.put(`${this.prefix}:limit`, limit)),
    );
  }

  private async dailyLimit(
    transaction: ProactiveNotificationTransaction,
    settings: ProactiveCharacterSettings | undefined,
  ): Promise<number> {
    if (settings) return settings.dailyLimit;
    return (await transaction.get<number>(`${this.prefix}:limit`)) ?? DEFAULT_PROACTIVE_DAILY_LIMIT;
  }

  recordActivity(characterId: string): Promise<void> {
    const settingsKey = this.settingsKey(characterId);
    return this.serialize(() =>
      this.storage.transaction(async (transaction) => {
        const now = validTime(this.clock().getTime());
        const previous = (await transaction.get<number>(`${settingsKey}:activity`)) ?? now;
        const lastActivityAt = Math.max(previous, now);
        await transaction.put(`${settingsKey}:activity`, lastActivityAt);
        const settings = await transaction.get<ProactiveCharacterSettings>(settingsKey);
        if (!settings?.enabled) return;
        const state = await this.readSchedule(transaction);
        this.replaceSchedule(
          state,
          characterId,
          nextProactiveAllowedTime(
            lastActivityAt + settings.idleMinutes * MINUTE_MS,
            settings.quietHours,
          ),
        );
        await this.writeSchedule(transaction, state);
      }),
    );
  }

  private async dispatch(
    alarm: ProactiveAlarm,
    sink: ProactiveNotificationSink,
  ): Promise<ProactiveAlarmOutcome> {
    const characterId = validateId(alarm.characterId);
    const reservationKey = `${this.prefix}:alarm:${validateId(alarm.alarmId)}`;
    const settingsKey = this.settingsKey(alarm.characterId);
    const reservation = await this.storage.transaction(async (transaction) => {
      const now = validTime(this.clock().getTime());
      const day = proactiveNotificationDay(new Date(now));
      const settings = await transaction.get<ProactiveCharacterSettings>(settingsKey);
      const enabled =
        (await transaction.get<boolean>(`${this.prefix}:enabled:${characterId}`)) ?? false;
      const dailyLimit = await this.dailyLimit(transaction, settings);
      const counterKey = `${this.prefix}:day:${day}:${characterId}`;
      const reservedToday = (await transaction.get<number>(counterKey)) ?? 0;
      const alreadyReserved = (await transaction.get<Reservation>(reservationKey)) !== undefined;
      const lastActivityAt = await transaction.get<number>(`${settingsKey}:activity`);
      const schedule = (await this.readSchedule(transaction)).entries.find(
        (entry) => entry.characterId === alarm.characterId,
      );
      let decision = evaluateProactiveNotification({
        enabled,
        dailyLimit,
        reservedToday,
        alreadyReserved,
        now,
        settings,
        lastActivityAt,
      });
      if (decision === "allowed" && schedule) {
        if (schedule.alarmId !== alarm.alarmId || schedule.dueAt === null) decision = "stale-alarm";
        else if (schedule.dueAt > now) decision = "not-due";
      }
      if (decision === "allowed") {
        // 送信成功直後に alarm が落ちても、再試行から同じ通知を送らんため先に確定する。
        await transaction.put(reservationKey, { day, characterId: alarm.characterId });
        await transaction.put(counterKey, reservedToday + 1);
      }
      return { decision, day, settings, lastActivityAt };
    });
    if (reservation.decision !== "allowed") return reservation.decision;

    const currentTime = validTime(this.clock().getTime());
    // commit 待ちに日付や静穏時間を跨いだ通知は、古い許可のまま送らん。
    if (proactiveNotificationDay(new Date(currentTime)) !== reservation.day)
      return "expired-window";
    if (reservation.settings) {
      if (isProactiveQuietTime(currentTime, reservation.settings.quietHours)) return "quiet-hours";
      if (
        reservation.lastActivityAt !== undefined &&
        currentTime < reservation.lastActivityAt + reservation.settings.idleMinutes * MINUTE_MS
      )
        return "idle";
    }
    // 送信先の結果が不明でも予約を戻さず、重複防止と上限を優先する。
    try {
      await sink.send({ ...alarm, idempotencyKey: reservationKey });
    } catch (error) {
      throw new ProactiveNotificationSendError(error);
    }
    return "attempted";
  }

  handleAlarm(
    alarm: ProactiveAlarm,
    sink: ProactiveNotificationSink,
  ): Promise<ProactiveAlarmOutcome> {
    const occurrence = { ...alarm };
    validateId(occurrence.characterId);
    validateId(occurrence.alarmId);
    return this.serialize(() => this.dispatch(occurrence, sink));
  }

  runAlarm(
    sink: ProactiveNotificationSink,
  ): Promise<{ characterId: string; outcome: ProactiveAlarmOutcome }[]> {
    return this.serialize(async () => {
      const now = validTime(this.clock().getTime());
      const entries = await this.storage.transaction(
        async (transaction) => (await this.readSchedule(transaction)).entries,
      );
      const results: { characterId: string; outcome: ProactiveAlarmOutcome }[] = [];
      let sinkFailure: ProactiveNotificationSendError | undefined;
      for (const entry of entries) {
        if (entry.dueAt === null || entry.dueAt > now) continue;
        let outcome: ProactiveAlarmOutcome;
        try {
          outcome = await this.dispatch(entry, sink);
        } catch (error) {
          if (!(error instanceof ProactiveNotificationSendError)) throw error;
          sinkFailure ??= error;
          outcome = "send-failed";
        }
        results.push({ characterId: entry.characterId, outcome });
        await this.storage.transaction(async (transaction) => {
          const state = await this.readSchedule(transaction);
          const current = state.entries.find(
            (candidate) => candidate.characterId === entry.characterId,
          );
          if (current?.alarmId !== entry.alarmId) return;
          const settingsKey = this.settingsKey(entry.characterId);
          const settings = await transaction.get<ProactiveCharacterSettings>(settingsKey);
          const lastActivityAt = (await transaction.get<number>(`${settingsKey}:activity`)) ?? 0;
          const currentTime = validTime(this.clock().getTime());
          let nextAt: number | null = null;
          if (settings?.enabled) {
            const minimum =
              outcome === "daily-limit"
                ? nextJapanMidnight(currentTime)
                : outcome === "quiet-hours" || outcome === "idle"
                  ? Math.max(currentTime, lastActivityAt + settings.idleMinutes * MINUTE_MS)
                  : currentTime + settings.idleMinutes * MINUTE_MS;
            nextAt = nextProactiveAllowedTime(minimum, settings.quietHours);
          }
          this.replaceSchedule(state, entry.characterId, nextAt);
          await this.writeSchedule(transaction, state);
        });
      }
      await this.storage.transaction(async (transaction) =>
        this.writeSchedule(transaction, await this.readSchedule(transaction)),
      );
      if (sinkFailure) throw sinkFailure;
      return results;
    });
  }
}
