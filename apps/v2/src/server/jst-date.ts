// 「日」の区切りは利用者の日付感覚に合わせて JST（UTC+9）の 0 時。
// 日付の鍵を UTC の toISOString で作ると朝 9 時に日が変わるので、ここ 1 箇所に揃える。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const jstDayStartMs = (nowMs: number): number =>
  Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;

// JST の日付を YYYY-MM-DD で返す。冪等キーや有効期限の比較に使う。
export const jstDateKey = (epochMs: number): string =>
  new Date(epochMs + JST_OFFSET_MS).toISOString().slice(0, 10);
