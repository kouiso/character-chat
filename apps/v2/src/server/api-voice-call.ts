// 音声通話の日次無料枠 API（RIT-213）。JST 0 時区切り（usage-limit と同じ境目）。
// GET=残り照会、POST {seconds}=使用秒数の積算（上限で頭打ち、超過分は切り捨て）。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { jstDayStartMs } from "./usage-limit";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const FREE_SECONDS_DEFAULT = 180; // MiraiMind 型: 1日最初3分無料
// 本人専用運用の V2_UNLIMITED=1 では日次枠を実質無制限にする。
const quotaLimit = (env: {
  V2_VOICE_CALL_FREE_SECONDS?: string;
  V2_UNLIMITED?: string;
}): number => {
  if (env.V2_UNLIMITED === "1") return Number.MAX_SAFE_INTEGER;
  const parsed = Number(env.V2_VOICE_CALL_FREE_SECONDS);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : FREE_SECONDS_DEFAULT;
};

const readUsed = async (db: D1Database, dayStart: number): Promise<number> => {
  const row = await db
    .prepare("SELECT seconds FROM v2_voice_call_usage WHERE user_id = ? AND day_start = ?")
    .bind(LOCAL_USER_ID, dayStart)
    .first<{ seconds: number }>();
  return row?.seconds ?? 0;
};

const quotaBody = async (env: {
  DB: D1Database;
  V2_VOICE_CALL_FREE_SECONDS?: string;
}): Promise<Record<string, unknown>> => {
  const limitSeconds = quotaLimit(env);
  const usedSeconds = await readUsed(env.DB, jstDayStartMs(Date.now()));
  return {
    limitSeconds,
    usedSeconds,
    remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
  };
};

export const handleVoiceCallQuotaGet = async (): Promise<Response> => {
  const { env } = await getPlatform();
  return json(200, await quotaBody(env));
};

const addBodySchema = z.object({ seconds: z.number().int().min(1).max(60) });

export const handleVoiceCallQuotaAdd = async (request: Request): Promise<Response> => {
  // sendBeacon は text/plain で送るため json() ではなく text→parse に倒す。
  const raw = await request.text().catch(() => "");
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = addBodySchema.safeParse(body);
  if (!parsed.success) return json(400, { error: "invalid_body" });
  const { env } = await getPlatform();
  const dayStart = jstDayStartMs(Date.now());
  // 上限超過分は積まない（レースでも seconds が limit を大きく超えないよう read-after-write で頭打ち）。
  await env.DB.prepare(
    `INSERT INTO v2_voice_call_usage (user_id, day_start, seconds) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day_start) DO UPDATE SET seconds = seconds + excluded.seconds`,
  )
    .bind(LOCAL_USER_ID, dayStart, parsed.data.seconds)
    .run();
  const limitSeconds = quotaLimit(env);
  const used = await readUsed(env.DB, dayStart);
  if (used > limitSeconds)
    await env.DB.prepare(
      "UPDATE v2_voice_call_usage SET seconds = ? WHERE user_id = ? AND day_start = ?",
    )
      .bind(limitSeconds, LOCAL_USER_ID, dayStart)
      .run();
  return json(200, await quotaBody(env));
};
