import { jstDateKey } from "../server/jst-date";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["日曜", "月曜", "火曜", "水曜", "木曜", "金曜", "土曜"] as const;

// WORDING の日付の書き方: きょう・きのう、1 週間以内は曜日、それより前は「M月D日」。
// 同じ日を曜日と日付の 2 通りに書かんよう、境目は JST の日付の差だけで決める。
export const dayLabel = (epochMs: number, now = Date.now()): string => {
  const key = jstDateKey(epochMs);
  const daysAgo = Math.round(
    (Date.parse(`${jstDateKey(now)}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / DAY_MS,
  );
  if (daysAgo <= 0) return "きょう";
  if (daysAgo === 1) return "きのう";
  if (daysAgo < 7) return WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()];
  const [, month, day] = key.split("-").map(Number);
  return `${month}月${day}日`;
};
