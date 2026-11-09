// ユーザー設定（RIT-199）。今はセーフモード1本だけやけど、設定が増えても
// このテーブルへ列を足せばよい。drizzle 二重版の型衝突を避けて生 D1 で読み書きする。
export const readSafeMode = async (db: D1Database, userId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT safe_mode FROM v2_user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ safe_mode: number }>();
  return row?.safe_mode === 1;
};

export const setSafeMode = async (
  db: D1Database,
  userId: string,
  on: boolean,
  now: number,
): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO v2_user_settings (user_id, safe_mode, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET safe_mode = excluded.safe_mode, updated_at = excluded.updated_at",
    )
    .bind(userId, on ? 1 : 0, now)
    .run();
};

// RIT-205: チャットモード。quality=重いモデル+長め、standard=既定、light=軽いモデル+短め。
export const CHAT_MODES = ["quality", "standard", "light"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
export const isChatMode = (v: unknown): v is ChatMode =>
  typeof v === "string" && (CHAT_MODES as readonly string[]).includes(v);

export const readChatMode = async (db: D1Database, userId: string): Promise<ChatMode> => {
  const row = await db
    .prepare("SELECT chat_mode FROM v2_user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ chat_mode: string }>();
  return isChatMode(row?.chat_mode) ? row.chat_mode : "standard";
};

export const setChatMode = async (
  db: D1Database,
  userId: string,
  mode: ChatMode,
  now: number,
): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO v2_user_settings (user_id, chat_mode, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET chat_mode = excluded.chat_mode, updated_at = excluded.updated_at",
    )
    .bind(userId, mode, now)
    .run();
};

// RIT-203: 文体スタイル。地の文と台詞の配分を変える。モード（長さ・モデル）とは別軸。
export const CHAT_STYLES = ["balanced", "prose", "dialogue"] as const;
export type ChatStyle = (typeof CHAT_STYLES)[number];
const isChatStyle = (v: unknown): v is ChatStyle =>
  typeof v === "string" && (CHAT_STYLES as readonly string[]).includes(v);

export const readChatStyle = async (db: D1Database, userId: string): Promise<ChatStyle> => {
  const row = await db
    .prepare("SELECT style FROM v2_user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ style: string }>();
  return isChatStyle(row?.style) ? row.style : "balanced";
};

export const setChatStyle = async (
  db: D1Database,
  userId: string,
  style: ChatStyle,
  now: number,
): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO v2_user_settings (user_id, style, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET style = excluded.style, updated_at = excluded.updated_at",
    )
    .bind(userId, style, now)
    .run();
};

// RIT-211: 応答音声の自動再生 ON/OFF。手動再生はこの設定に関わらず残す。
export const readVoiceAutoplay = async (db: D1Database, userId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT voice_autoplay FROM v2_user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ voice_autoplay: number }>();
  return row?.voice_autoplay === 1;
};

export const setVoiceAutoplay = async (
  db: D1Database,
  userId: string,
  on: boolean,
  now: number,
): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO v2_user_settings (user_id, voice_autoplay, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET voice_autoplay = excluded.voice_autoplay, updated_at = excluded.updated_at",
    )
    .bind(userId, on ? 1 : 0, now)
    .run();
};
