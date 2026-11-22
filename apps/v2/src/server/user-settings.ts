// ユーザー設定（RIT-199）。今はセーフモード1本だけやけど、設定が増えても
// このテーブルへ列を足せばよい。drizzle 二重版の型衝突を避けて生 D1 で読み書きする。
// 読み出しの実体は @v2/db（engine の要約係も使うので層を揃えた、RIT-72）。
export { readSafeMode } from "@v2/db";

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

// RIT-30 ギャップ（Saylo のユーザーの役割設定）: キャラから見たユーザー自身の人物像。
// 設定すると全キャラの会話へ共通のコンテキストとして渡る。空文字は消去と同じ扱い。
export const USER_PERSONA_MAX_CHARS = 2000;

export const readUserPersona = async (db: D1Database, userId: string): Promise<string> => {
  const row = await db
    .prepare("SELECT user_persona FROM v2_user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ user_persona: string | null }>();
  return row?.user_persona ?? "";
};

// 生成 deps へ渡す用。DB 無しや未設定は undefined に正規化して
// 呼び出し側（startTurn）で分岐を増やさない。
export const readUserPersonaForPrompt = async (
  db: D1Database | undefined,
  userId: string,
): Promise<string | undefined> =>
  db ? (await readUserPersona(db, userId)) || undefined : undefined;

// 燈デザイン「持つ手」。左はトークの送信と「＋」の並びを左右入れ替える。
export const HANDEDNESSES = ["right", "left"] as const;
export type Handedness = (typeof HANDEDNESSES)[number];
const isHandedness = (v: unknown): v is Handedness =>
  typeof v === "string" && (HANDEDNESSES as readonly string[]).includes(v);

export const readHandedness = async (db: D1Database, userId: string): Promise<Handedness> => {
  const row = await db
    .prepare("SELECT handedness FROM v2_user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ handedness: string }>();
  return isHandedness(row?.handedness) ? row.handedness : "right";
};

export const setHandedness = async (
  db: D1Database,
  userId: string,
  handedness: Handedness,
  now: number,
): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO v2_user_settings (user_id, handedness, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET handedness = excluded.handedness, updated_at = excluded.updated_at",
    )
    .bind(userId, handedness, now)
    .run();
};

// 燈デザイン「通知の設定」。master（受け取る）・届くもの 4 種・文を隠す。
// push 送信側（proactive-sink）も同じ行を読んで止めるので、ここが正本。
export type NotificationSettings = {
  enabled: boolean;
  proactive: boolean;
  feed: boolean;
  call: boolean;
  anniversary: boolean;
  hideText: boolean;
};

const NOTIFY_COLUMNS =
  "notify_enabled, notify_proactive, notify_feed, notify_call, notify_anniversary, notify_hide_text";

type NotifyRow = {
  notify_enabled: number;
  notify_proactive: number;
  notify_feed: number;
  notify_call: number;
  notify_anniversary: number;
  notify_hide_text: number;
};

// 行が無い時の既定は schema 側の DEFAULT と揃える（master=off・種類=on・隠す=on）。
const NOTIFY_DEFAULTS: NotificationSettings = {
  enabled: false,
  proactive: true,
  feed: true,
  call: true,
  anniversary: true,
  hideText: true,
};

export const readNotificationSettings = async (
  db: D1Database,
  userId: string,
): Promise<NotificationSettings> => {
  const row = await db
    .prepare(`SELECT ${NOTIFY_COLUMNS} FROM v2_user_settings WHERE user_id = ?`)
    .bind(userId)
    .first<NotifyRow>();
  if (!row) return NOTIFY_DEFAULTS;
  return {
    enabled: row.notify_enabled === 1,
    proactive: row.notify_proactive === 1,
    feed: row.notify_feed === 1,
    call: row.notify_call === 1,
    anniversary: row.notify_anniversary === 1,
    hideText: row.notify_hide_text === 1,
  };
};

const NOTIFY_COLUMN_BY_KEY: Record<keyof NotificationSettings, string> = {
  enabled: "notify_enabled",
  proactive: "notify_proactive",
  feed: "notify_feed",
  call: "notify_call",
  anniversary: "notify_anniversary",
  hideText: "notify_hide_text",
};

// 1 項目だけ上書きする（押してすぐ効く設定は項目ごとに PUT される）。
// 列名は外部入力を通さず固定レコードから引く。
export const setNotificationSetting = async (
  db: D1Database,
  userId: string,
  key: keyof NotificationSettings,
  on: boolean,
  now: number,
): Promise<void> => {
  const column = NOTIFY_COLUMN_BY_KEY[key];
  await db
    .prepare(
      `INSERT INTO v2_user_settings (user_id, ${column}, updated_at) VALUES (?, ?, ?) ` +
        `ON CONFLICT(user_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`,
    )
    .bind(userId, on ? 1 : 0, now)
    .run();
};

export const setUserPersona = async (
  db: D1Database,
  userId: string,
  persona: string,
  now: number,
): Promise<void> => {
  const trimmed = persona.slice(0, USER_PERSONA_MAX_CHARS);
  await db
    .prepare(
      "INSERT INTO v2_user_settings (user_id, user_persona, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET user_persona = excluded.user_persona, updated_at = excluded.updated_at",
    )
    .bind(userId, trimmed.length > 0 ? trimmed : null, now)
    .run();
};
