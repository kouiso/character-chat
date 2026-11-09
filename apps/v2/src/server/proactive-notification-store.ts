import {
  DEFAULT_PROACTIVE_DAILY_LIMIT,
  evaluateProactiveNotification,
  isProactiveQuietTime,
  nextJapanMidnight,
  nextProactiveAllowedTime,
  proactiveNotificationDay,
  validateProactiveSettings,
} from "./proactive-notification-policy";
import { RECALL_INTERVAL_MS } from "./proactive-recall";

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

// 発火の種類。idle=従来の放置時間トリガ、recall=記憶由来の想起チェック（RIT-198）。
export type ProactiveTrigger = "idle" | "recall";
export type ProactiveAlarm = { alarmId: string; characterId: string; trigger?: ProactiveTrigger };
export type ProactiveNotificationSink = {
  send(notification: ProactiveAlarm & { idempotencyKey: string }): Promise<void>;
  // recall は記憶キューが無い時に送信自体を止める。予約（日次枠）を消費せんよう先に聞く。
  preflight?(alarm: ProactiveAlarm): Promise<"send" | "skip">;
};
export type ProactiveSchedule = ProactiveAlarm & { dueAt: number | null };
export type ProactiveAlarmOutcome =
  | Exclude<ProactiveNotificationDecision, "allowed">
  | "attempted"
  | "send-failed"
  | "no-recall-cue";
type ScheduleState = { sequence: number; entries: ProactiveSchedule[] };
type Reservation = { day: string; characterId: string };
type ProactiveDispatchResult =
  | { outcome: "daily-limit"; dailyResetAt: number }
  | { outcome: Exclude<ProactiveAlarmOutcome, "daily-limit"> };

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

// 発火結果から次回 dueAt を決める。recall は1日おき、idle は従来の間隔・上限ルール。
const nextDueAt = (input: {
  trigger: ProactiveTrigger;
  settings: ProactiveCharacterSettings;
  dispatchResult: ProactiveDispatchResult;
  outcome: ProactiveAlarmOutcome;
  lastActivityAt: number;
  now: number;
}): number => {
  const { settings, dispatchResult, outcome, lastActivityAt, now } = input;
  if (input.trigger === "recall") {
    return nextProactiveAllowedTime(
      outcome === "send-failed" ? now + settings.idleMinutes * MINUTE_MS : now + RECALL_INTERVAL_MS,
      settings.quietHours,
    );
  }
  const minimum =
    dispatchResult.outcome === "daily-limit"
      ? Math.max(
          dispatchResult.dailyResetAt,
          now,
          lastActivityAt + settings.idleMinutes * MINUTE_MS,
        )
      : outcome === "quiet-hours" || outcome === "idle"
        ? Math.max(now, lastActivityAt + settings.idleMinutes * MINUTE_MS)
        : now + settings.idleMinutes * MINUTE_MS;
  return nextProactiveAllowedTime(minimum, settings.quietHours);
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

  private replaceSchedule(
    state: ScheduleState,
    characterId: string,
    trigger: ProactiveTrigger,
    dueAt: number | null,
  ): void {
    if (!Number.isSafeInteger(state.sequence + 1))
      throw new RangeError("Proactive schedule exhausted");
    state.sequence++;
    const entry = {
      characterId,
      trigger,
      alarmId: `scheduled-${state.sequence}`,
      dueAt: dueAt === null ? null : validTime(dueAt),
    };
    const index = state.entries.findIndex(
      (candidate) =>
        candidate.characterId === characterId && (candidate.trigger ?? "idle") === trigger,
    );
    if (index === -1) state.entries.push(entry);
    else state.entries[index] = entry;
  }

  // idle と recall の2本をキャラごとに持つ。trigger 未指定の旧エントリは idle 扱い。
  private findEntry(
    state: ScheduleState,
    characterId: string,
    trigger: ProactiveTrigger,
  ): ProactiveSchedule | undefined {
    return state.entries.find(
      (candidate) =>
        candidate.characterId === characterId && (candidate.trigger ?? "idle") === trigger,
    );
  }

  private recallDueAt(settings: ProactiveCharacterSettings, baseAt: number): number | null {
    return settings.enabled
      ? nextProactiveAllowedTime(baseAt + RECALL_INTERVAL_MS, settings.quietHours)
      : null;
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
        this.replaceSchedule(state, characterId, "idle", dueAt);
        this.replaceSchedule(
          state,
          characterId,
          "recall",
          this.recallDueAt(snapshot, Math.max(now, lastActivityAt)),
        );
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
          "idle",
          enabled
            ? nextProactiveAllowedTime(now + settings.idleMinutes * MINUTE_MS, settings.quietHours)
            : null,
        );
        this.replaceSchedule(
          state,
          characterId,
          "recall",
          this.recallDueAt({ ...settings, enabled }, now),
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
          "idle",
          nextProactiveAllowedTime(
            lastActivityAt + settings.idleMinutes * MINUTE_MS,
            settings.quietHours,
          ),
        );
        this.replaceSchedule(
          state,
          characterId,
          "recall",
          this.recallDueAt(settings, lastActivityAt),
        );
        await this.writeSchedule(transaction, state);
      }),
    );
  }

  // 送信してよいか判定し、許可ならその場で日次枠と冪等キーを確定させる。
  private async reserve(
    alarm: ProactiveAlarm,
    trigger: ProactiveTrigger,
    reservationKey: string,
  ): Promise<{
    decision: ProactiveNotificationDecision;
    day: string;
    settings?: ProactiveCharacterSettings;
    lastActivityAt?: number;
    dailyResetAt: number;
  }> {
    const characterId = validateId(alarm.characterId);
    const settingsKey = this.settingsKey(alarm.characterId);
    return this.storage.transaction(async (transaction) => {
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
      const schedule = this.findEntry(
        await this.readSchedule(transaction),
        alarm.characterId,
        trigger,
      );
      let decision = evaluateProactiveNotification({
        enabled,
        dailyLimit,
        reservedToday,
        alreadyReserved,
        now,
        settings,
        // recall は活動直後でも記念日・昨日の話なら送ってよいので idle 判定を外す。
        lastActivityAt: trigger === "idle" ? lastActivityAt : undefined,
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
      return { decision, day, settings, lastActivityAt, dailyResetAt: nextJapanMidnight(now) };
    });
  }

  // 予約コミット待ちに日付・静穏時間・活動を跨いだ通知は、古い許可のまま送らん。
  private recheck(
    reservation: { day: string; settings?: ProactiveCharacterSettings; lastActivityAt?: number },
    trigger: ProactiveTrigger,
    now: number,
  ): Exclude<ProactiveAlarmOutcome, "daily-limit"> | null {
    if (proactiveNotificationDay(new Date(now)) !== reservation.day) return "expired-window";
    if (!reservation.settings) return null;
    if (isProactiveQuietTime(now, reservation.settings.quietHours)) return "quiet-hours";
    if (
      trigger === "idle" &&
      reservation.lastActivityAt !== undefined &&
      now < reservation.lastActivityAt + reservation.settings.idleMinutes * MINUTE_MS
    )
      return "idle";
    return null;
  }

  private async dispatch(
    alarm: ProactiveAlarm,
    sink: ProactiveNotificationSink,
  ): Promise<ProactiveDispatchResult> {
    const trigger = alarm.trigger ?? "idle";
    // recall は日次枠を予約する前に記憶キューを確かめる。無い日は送らず枠も使わん。
    if (trigger === "recall") {
      const verdict = (await sink.preflight?.(alarm)) ?? "send";
      if (verdict === "skip") return { outcome: "no-recall-cue" };
    }
    const reservationKey = `${this.prefix}:alarm:${validateId(alarm.alarmId)}`;
    const reservation = await this.reserve(alarm, trigger, reservationKey);
    if (reservation.decision === "daily-limit")
      return { outcome: "daily-limit", dailyResetAt: reservation.dailyResetAt };
    if (reservation.decision !== "allowed") return { outcome: reservation.decision };

    const stale = this.recheck(reservation, trigger, validTime(this.clock().getTime()));
    if (stale) return { outcome: stale };
    // 送信先の結果が不明でも予約を戻さず、重複防止と上限を優先する。
    try {
      await sink.send({ ...alarm, idempotencyKey: reservationKey });
    } catch (error) {
      throw new ProactiveNotificationSendError(error);
    }
    return { outcome: "attempted" };
  }

  handleAlarm(
    alarm: ProactiveAlarm,
    sink: ProactiveNotificationSink,
  ): Promise<ProactiveAlarmOutcome> {
    const occurrence = { ...alarm };
    validateId(occurrence.characterId);
    validateId(occurrence.alarmId);
    return this.serialize(async () => (await this.dispatch(occurrence, sink)).outcome);
  }

  // 発火済みエントリの次回時刻を結果別に決める。idle は従来の間隔・上限ルール、
  // recall は1日おき（送信失敗のみ idle 間隔で粘り直す）。
  private async rescheduleEntry(
    transaction: ProactiveNotificationTransaction,
    entry: ProactiveSchedule,
    dispatchResult: ProactiveDispatchResult,
    outcome: ProactiveAlarmOutcome,
  ): Promise<void> {
    const state = await this.readSchedule(transaction);
    const trigger = entry.trigger ?? "idle";
    const current = this.findEntry(state, entry.characterId, trigger);
    if (current?.alarmId !== entry.alarmId) return;
    const settingsKey = this.settingsKey(entry.characterId);
    const settings = await transaction.get<ProactiveCharacterSettings>(settingsKey);
    const lastActivityAt = (await transaction.get<number>(`${settingsKey}:activity`)) ?? 0;
    const nextAt = settings?.enabled
      ? nextDueAt({
          trigger,
          settings,
          dispatchResult,
          outcome,
          lastActivityAt,
          now: validTime(this.clock().getTime()),
        })
      : null;
    this.replaceSchedule(state, entry.characterId, trigger, nextAt);
    await this.writeSchedule(transaction, state);
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
        let dispatchResult: ProactiveDispatchResult;
        try {
          dispatchResult = await this.dispatch(entry, sink);
        } catch (error) {
          if (!(error instanceof ProactiveNotificationSendError)) throw error;
          sinkFailure ??= error;
          dispatchResult = { outcome: "send-failed" };
        }
        const { outcome } = dispatchResult;
        results.push({ characterId: entry.characterId, outcome });
        await this.storage.transaction((transaction) =>
          this.rescheduleEntry(transaction, entry, dispatchResult, outcome),
        );
      }
      await this.storage.transaction(async (transaction) =>
        this.writeSchedule(transaction, await this.readSchedule(transaction)),
      );
      if (sinkFailure) throw sinkFailure;
      return results;
    });
  }
}
