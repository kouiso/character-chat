export const CHUNK_MS_PER_CHARACTER = 40;
export const MAX_CHUNK_INTERVAL_MS = 3_000;

const MAX_TIMESTAMP = 8_640_000_000_000_000;

// タグは表示する字数に含めず、絵文字のサロゲートペアも一字として待ち時間を決める。
const intervalFor = (text: string): number =>
  Math.min(
    MAX_CHUNK_INTERVAL_MS,
    Math.max(1, [...text.replace(/<\/?(?:action|dialogue|inner)>/g, "")].length) *
      CHUNK_MS_PER_CHARACTER,
  );

export const scheduleChunks = <T extends { seq: number; text: string }>(
  chunks: readonly T[],
  startAt: number,
): (T & { scheduledAt: number })[] => {
  if (!Number.isSafeInteger(startAt) || startAt < 0 || startAt > MAX_TIMESTAMP) {
    throw new RangeError("chunk の基準時刻が不正");
  }
  let scheduledAt = startAt;
  let interval = 0;
  return [...chunks]
    .sort((a, b) => a.seq - b.seq)
    .map((chunk) => {
      scheduledAt += interval;
      if (scheduledAt > MAX_TIMESTAMP) throw new RangeError("chunk の予定時刻が範囲外");
      interval = intervalFor(chunk.text);
      return { ...chunk, scheduledAt };
    });
};
