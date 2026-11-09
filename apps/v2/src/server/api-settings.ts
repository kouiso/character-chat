// ユーザー設定 API（RIT-199）。GET=現在値、PUT=更新（冪等）。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import { readSafeMode, setSafeMode } from "./user-settings";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

// GET /api/settings — ユーザー設定を返す。行が無くても既定値を返す。
export const handleSettingsReadRequest = async (): Promise<Response> => {
  const { env } = await getPlatform();
  return json(200, { safeMode: await readSafeMode(env.DB, LOCAL_USER_ID) });
};

const settingsSchema = z.object({
  safeMode: z.boolean(),
});

// PUT /api/settings — 設定を丸ごと置き換える（セーフ切替は次ターンから効く）。
export const handleSettingsWriteRequest = async (request: Request): Promise<Response> => {
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(400, { message: "safeMode に true か false を指定してください。" });
  }
  const { env } = await getPlatform();
  await setSafeMode(env.DB, LOCAL_USER_ID, parsed.data.safeMode, Date.now());
  return json(200, { safeMode: parsed.data.safeMode });
};
