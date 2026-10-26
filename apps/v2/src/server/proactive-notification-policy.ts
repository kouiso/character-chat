export const DEFAULT_PROACTIVE_DAILY_LIMIT = 3;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const JAPAN_OFFSET_MS = 9 * 60 * MINUTE_MS;

export type ProactiveQuietHours = { startMinute: number; endMinute: number };
export type ProactiveCharacterSettings = {
  enabled: boolean;
  dailyLimit: number;
  idleMinutes: number;
  quietHours: ProactiveQuietHours | null;
};

export type ProactiveNotificationDecision =
  | "allowed"
  | "disabled"
  | "daily-limit"
  | "duplicate"
  | "quiet-hours"
  | "idle"
  | "not-due"
  | "stale-alarm"
  | "expired-window";

export const proactiveNotificationDay = (now: Date): string =>
  new Date(now.getTime() + JAPAN_OFFSET_MS).toISOString().slice(0, 10);

export const nextJapanMidnight = (now: number): number =>
  (Math.floor((now + JAPAN_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - JAPAN_OFFSET_MS;

export const isProactiveQuietTime = (
  now: number,
  quietHours: ProactiveQuietHours | null,
): boolean => {
  if (!quietHours) return false;
  const local = new Date(now + JAPAN_OFFSET_MS);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const { startMinute, endMinute } = quietHours;
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
};

export const nextProactiveAllowedTime = (
  now: number,
  quietHours: ProactiveQuietHours | null,
): number => {
  if (!quietHours || !isProactiveQuietTime(now, quietHours)) return now;
  const localMidnight = nextJapanMidnight(now) - DAY_MS;
  const end = localMidnight + quietHours.endMinute * MINUTE_MS;
  return end > now ? end : end + DAY_MS;
};

const isMinuteOfDay = (minute: number): boolean =>
  Number.isInteger(minute) && minute >= 0 && minute < 1440;

const validateQuietHours = (quiet: ProactiveQuietHours | null): ProactiveQuietHours | null => {
  if (quiet === null) return null;
  if (
    !quiet ||
    !isMinuteOfDay(quiet.startMinute) ||
    !isMinuteOfDay(quiet.endMinute) ||
    quiet.startMinute === quiet.endMinute
  )
    throw new RangeError("Invalid proactive quiet hours");
  return { ...quiet };
};

export const validateProactiveSettings = (
  settings: ProactiveCharacterSettings,
): ProactiveCharacterSettings => {
  if (
    typeof settings.enabled !== "boolean" ||
    !Number.isSafeInteger(settings.dailyLimit) ||
    settings.dailyLimit < 0
  )
    throw new RangeError("Invalid proactive settings");
  if (
    !Number.isSafeInteger(settings.idleMinutes) ||
    settings.idleMinutes < 1 ||
    !Number.isSafeInteger(settings.idleMinutes * MINUTE_MS)
  )
    throw new RangeError("Invalid proactive idle interval");
  return { ...settings, quietHours: validateQuietHours(settings.quietHours) };
};

export const evaluateProactiveNotification = (input: {
  enabled: boolean;
  dailyLimit: number;
  reservedToday: number;
  alreadyReserved: boolean;
  now?: number;
  settings?: ProactiveCharacterSettings;
  lastActivityAt?: number;
}): ProactiveNotificationDecision => {
  if (!input.enabled) return "disabled";
  if (input.alreadyReserved) return "duplicate";
  if (input.now !== undefined && input.settings) {
    if (isProactiveQuietTime(input.now, input.settings.quietHours)) return "quiet-hours";
    if (
      input.lastActivityAt !== undefined &&
      input.now < input.lastActivityAt + input.settings.idleMinutes * MINUTE_MS
    )
      return "idle";
  }
  if (input.reservedToday >= input.dailyLimit) return "daily-limit";
  return "allowed";
};
