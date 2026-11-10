import { countUserTurnsSince } from "@v2/db";

import { LOCAL_USER_ID } from "./identity";

import type { V2Db } from "@v2/db";

// 数字は wrangler.jsonc の vars.V2_DAILY_TURN_LIMIT が正本（RIT-103: 設定ファイルに数字で置く）。
export const DEFAULT_DAILY_TURN_LIMIT = 300;

export const dailyTurnLimit = (env: { V2_DAILY_TURN_LIMIT?: string }): number => {
  const parsed = Number(env.V2_DAILY_TURN_LIMIT);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_TURN_LIMIT;
};

// 1日の区切りは利用者の日付感覚に合わせて JST（UTC+9）の 0 時。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const jstDayStartMs = (nowMs: number): number =>
  Math.floor((nowMs + JST_OFFSET_MS) / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000) -
  JST_OFFSET_MS;

export const checkDailyTurnLimit = async (
  db: V2Db,
  env: { V2_DAILY_TURN_LIMIT?: string; V2_UNLIMITED?: string },
  nowMs: number,
  userId = LOCAL_USER_ID,
): Promise<{ allowed: boolean; limit: number; used: number }> => {
  // 本人専用運用の V2_UNLIMITED=1 では枠を消す（表示は最大整数へ倒す）。
  const unlimited = env.V2_UNLIMITED === "1";
  const limit = unlimited ? Number.MAX_SAFE_INTEGER : dailyTurnLimit(env);
  const used = await countUserTurnsSince(db, {
    userId,
    sinceMs: jstDayStartMs(nowMs),
  });
  return { allowed: unlimited || used < limit, limit, used };
};
