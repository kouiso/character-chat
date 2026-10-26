export const DEFAULT_PROACTIVE_DAILY_LIMIT = 3;

export type ProactiveNotificationDecision = "allowed" | "disabled" | "daily-limit" | "duplicate";

export const proactiveNotificationDay = (now: Date): string => now.toISOString().slice(0, 10);

export const evaluateProactiveNotification = (input: {
  enabled: boolean;
  dailyLimit: number;
  reservedToday: number;
  alreadyReserved: boolean;
}): ProactiveNotificationDecision => {
  if (!input.enabled) return "disabled";
  if (input.alreadyReserved) return "duplicate";
  if (input.reservedToday >= input.dailyLimit) return "daily-limit";
  return "allowed";
};
