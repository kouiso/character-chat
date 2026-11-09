// リテンション報酬 API（RIT-194）。ログイン特典・広告報酬・1日券の各 POST と
// 1日券の状態 GET。実体は retention.ts、ここは入力検証とエラー写像だけ。
import { z } from "zod";

import { CurrencyError } from "./currency";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { activateDailyPass, claimLoginBonus, readDailyPass, recordAdReward } from "./retention";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const errorResponse = (error: unknown): Response => {
  if (error instanceof CurrencyError) {
    return json(error.status, { message: error.message });
  }
  throw error;
};

// POST /api/currency/login-bonus — その日の特典を受け取る（同日再送は既存を返す）。
export const handleLoginBonusRequest = async (): Promise<Response> => {
  try {
    const { env } = await getPlatform();
    const result = await claimLoginBonus(env.DB, LOCAL_USER_ID);
    return json(200, result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
};

const adRewardSchema = z.object({
  attemptId: z.string().min(1).max(200),
});

// POST /api/currency/ad-reward — 広告視聴完了の通知（attemptId 冪等）。
export const handleAdRewardRequest = async (request: Request): Promise<Response> => {
  const parsed = adRewardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(400, { message: "attemptIdを指定してください。" });
  }
  try {
    const { env } = await getPlatform();
    const result = await recordAdReward(env.DB, {
      userId: LOCAL_USER_ID,
      attemptId: parsed.data.attemptId,
    });
    return json(200, result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
};

// POST /api/currency/daily-pass — 1日券を購入して24時間の機能解放（残高不足は409）。
export const handleDailyPassActivateRequest = async (): Promise<Response> => {
  try {
    const { env } = await getPlatform();
    const result = await activateDailyPass(env.DB, LOCAL_USER_ID);
    return json(200, result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
};

// GET /api/currency/daily-pass — 有効な1日券の状態を返す。
export const handleDailyPassStatusRequest = async (): Promise<Response> => {
  try {
    const { env } = await getPlatform();
    const result = await readDailyPass(env.DB, LOCAL_USER_ID);
    return json(200, result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
};
