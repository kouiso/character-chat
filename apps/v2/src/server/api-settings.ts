// ユーザー設定 API（RIT-199）。GET=現在値、PUT=更新（冪等・渡した項目だけ置き換え）。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";
import {
  CHAT_MODES,
  CHAT_STYLES,
  HANDEDNESSES,
  USER_PERSONA_MAX_CHARS,
  readChatMode,
  readChatStyle,
  readHandedness,
  readNotificationSettings,
  readSafeMode,
  readUserPersona,
  readVoiceAutoplay,
  setChatMode,
  setChatStyle,
  setHandedness,
  setNotificationSetting,
  setSafeMode,
  setUserPersona,
  setVoiceAutoplay,
} from "./user-settings";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const readSettings = async () => {
  const { env } = await getPlatform();
  const notify = await readNotificationSettings(env.DB, LOCAL_USER_ID);
  return {
    safeMode: await readSafeMode(env.DB, LOCAL_USER_ID),
    chatMode: await readChatMode(env.DB, LOCAL_USER_ID),
    style: await readChatStyle(env.DB, LOCAL_USER_ID),
    voiceAutoplay: await readVoiceAutoplay(env.DB, LOCAL_USER_ID),
    userPersona: await readUserPersona(env.DB, LOCAL_USER_ID),
    handedness: await readHandedness(env.DB, LOCAL_USER_ID),
    // 燈デザイン「通知の設定」。押してすぐ効く項目として 1 キーずつ PUT される。
    notifyEnabled: notify.enabled,
    notifyProactive: notify.proactive,
    notifyFeed: notify.feed,
    notifyCall: notify.call,
    notifyAnniversary: notify.anniversary,
    notifyHideText: notify.hideText,
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
    // RIT-211: 応答音声の自動再生。
    voiceAutoplay: z.boolean().optional(),
    // RIT-30 ギャップ: AIから見たユーザーの人物像。
    userPersona: z.string().max(USER_PERSONA_MAX_CHARS).optional(),
    // 燈デザイン「持つ手」。トークの下の並びの左右。
    handedness: z.enum(HANDEDNESSES).optional(),
    // 燈デザイン「通知の設定」。
    notifyEnabled: z.boolean().optional(),
    notifyProactive: z.boolean().optional(),
    notifyFeed: z.boolean().optional(),
    notifyCall: z.boolean().optional(),
    notifyAnniversary: z.boolean().optional(),
    notifyHideText: z.boolean().optional(),
  })
  // 全部 optional なので「少なくとも1つある」を値で見る（条件列挙は複雑度が膨らむ）。
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "更新する項目を1つ以上指定してください。",
  });

// notify* API キー → 通知設定の項目名。クライアントはキーごとに PUT する。
const NOTIFY_KEY_MAP = {
  notifyEnabled: "enabled",
  notifyProactive: "proactive",
  notifyFeed: "feed",
  notifyCall: "call",
  notifyAnniversary: "anniversary",
  notifyHideText: "hideText",
} as const;

const NOTIFY_API_KEYS = Object.keys(NOTIFY_KEY_MAP) as (keyof typeof NOTIFY_KEY_MAP)[];

// 通知設定の notify* キーをまとめて書く。複雑度を本体から分けるため別関数。
const writeNotificationUpdates = async (
  env: Cloudflare.Env,
  data: z.infer<typeof settingsSchema>,
  now: number,
): Promise<void> => {
  for (const apiKey of NOTIFY_API_KEYS) {
    const value = data[apiKey];
    if (value !== undefined)
      await setNotificationSetting(env.DB, LOCAL_USER_ID, NOTIFY_KEY_MAP[apiKey], value, now);
  }
};

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
  if (parsed.data.voiceAutoplay !== undefined)
    await setVoiceAutoplay(env.DB, LOCAL_USER_ID, parsed.data.voiceAutoplay, now);
  if (parsed.data.userPersona !== undefined)
    await setUserPersona(env.DB, LOCAL_USER_ID, parsed.data.userPersona, now);
  if (parsed.data.handedness !== undefined)
    await setHandedness(env.DB, LOCAL_USER_ID, parsed.data.handedness, now);
  await writeNotificationUpdates(env, parsed.data, now);
  return json(200, await readSettings());
};
