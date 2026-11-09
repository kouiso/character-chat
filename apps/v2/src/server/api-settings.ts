// ユーザー設定 API（RIT-199）。GET=現在値、PUT=更新（冪等・渡した項目だけ置き換え）。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import {
  CHAT_MODES,
  CHAT_STYLES,
  readChatMode,
  readChatStyle,
  readSafeMode,
  setChatMode,
  setChatStyle,
  setSafeMode,
} from "./user-settings";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const readSettings = async () => {
  const { env } = await getPlatform();
  return {
    safeMode: await readSafeMode(env.DB, LOCAL_USER_ID),
    chatMode: await readChatMode(env.DB, LOCAL_USER_ID),
    style: await readChatStyle(env.DB, LOCAL_USER_ID),
  };
};

// GET /api/settings — ユーザー設定を返す。行が無くても既定値を返す。
export const handleSettingsReadRequest = async (): Promise<Response> =>
  json(200, await readSettings());

const settingsSchema = z
  .object({
    safeMode: z.boolean().optional(),
    // RIT-205: チャットモード（モデルチェーン・長さ上限の切替）。
    chatMode: z.enum(CHAT_MODES).optional(),
    // RIT-203: 文体スタイル（地の文/会話の配分）。
    style: z.enum(CHAT_STYLES).optional(),
  })
  .refine(
    (body) =>
      body.safeMode !== undefined || body.chatMode !== undefined || body.style !== undefined,
    {
      message: "更新する項目を1つ以上指定してください。",
    },
  );

// PUT /api/settings — 渡した項目だけ更新する（切替は次ターンから効く）。
export const handleSettingsWriteRequest = async (request: Request): Promise<Response> => {
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(400, {
      message: "safeMode・chatMode・style のどれかを正しい値で指定してください。",
    });
  }
  const { env } = await getPlatform();
  const now = Date.now();
  if (parsed.data.safeMode !== undefined)
    await setSafeMode(env.DB, LOCAL_USER_ID, parsed.data.safeMode, now);
  if (parsed.data.chatMode !== undefined)
    await setChatMode(env.DB, LOCAL_USER_ID, parsed.data.chatMode, now);
  if (parsed.data.style !== undefined)
    await setChatStyle(env.DB, LOCAL_USER_ID, parsed.data.style, now);
  return json(200, await readSettings());
};
