const MS_PER_CHARACTER = 50;
const MAX_INTERVAL_MS = 5_000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export const scheduleChunks = <T extends { text: string }>(
  chunks: readonly T[],
  now: number,
): (T & { scheduledAt: number })[] => {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP) {
    throw new RangeError("基準時刻が不正です");
  }
  let scheduledAt = now;
  return chunks.map((chunk) => {
    const text = chunk.text.replace(/<[^>]*>/g, "");
    scheduledAt += Math.min(Array.from(text).length * MS_PER_CHARACTER, MAX_INTERVAL_MS);
    if (!Number.isSafeInteger(scheduledAt) || scheduledAt > MAX_TIMESTAMP) {
      throw new RangeError("予定時刻が範囲を超えました");
    }
    return { ...chunk, scheduledAt };
  });
};
