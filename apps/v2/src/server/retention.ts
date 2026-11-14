// リテンション導線（RIT-194）。ログイン特典・広告視聴報酬・1日券を通貨台帳へ積む。
// 付与は全部冪等（1日1回・attemptId 単位・同日1購入）で、残高の正は v2_currency_ledger。
import { bonusCurrency, spendCurrency } from "./currency";
import { ensureSeedBalance } from "./generation-billing";
import { jstDateKey, jstDayStartMs } from "./jst-date";
import { readPlan } from "./plan";

// ログイン特典: 基本10 + 連続日数×5（上限50）。MiraiMind 型の連続ログイン増量。
const LOGIN_BONUS_BASE = 10;
const LOGIN_BONUS_STEP = 5;
const LOGIN_BONUS_CAP = 50;
const AD_REWARD_AMOUNT = 5;
const DAILY_PASS_COST = 100;
const DAILY_PASS_HOURS = 24;

const DAY_MS = 86_400_000;

interface LoginBonusRow {
  id: string;
  day: string;
  streak: number;
  amount: number;
  ledger_id: string;
  created_at: number;
}

export interface LoginBonusResult {
  // その日に新規付与したか（false なら当日受取済み）。
  claimed: boolean;
  day: string;
  streak: number;
  amount: number;
  balance: number;
}

const lastLoginBonus = async (db: D1Database, userId: string): Promise<LoginBonusRow | null> => {
  const row = await db
    .prepare(
      "SELECT id, day, streak, amount, ledger_id, created_at FROM v2_login_bonus WHERE user_id = ? ORDER BY day DESC LIMIT 1",
    )
    .bind(userId)
    .first<Record<string, unknown>>();
  return row
    ? {
        id: String(row.id),
        day: String(row.day),
        streak: Number(row.streak),
        amount: Number(row.amount),
        ledger_id: String(row.ledger_id),
        created_at: Number(row.created_at),
      }
    : null;
};

const todayBonus = async (
  db: D1Database,
  userId: string,
  day: string,
  dayStart: number,
): Promise<LoginBonusRow | null> => {
  const row = await db
    .prepare(
      "SELECT id, day, streak, amount, ledger_id, created_at FROM v2_login_bonus WHERE user_id = ? AND (day = ? OR (created_at >= ? AND created_at < ?)) ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId, day, dayStart, dayStart + DAY_MS)
    .first<Record<string, unknown>>();
  return row
    ? {
        id: String(row.id),
        day: String(row.day),
        streak: Number(row.streak),
        amount: Number(row.amount),
        ledger_id: String(row.ledger_id),
        created_at: Number(row.created_at),
      }
    : null;
};

const loginBonusAmount = (streak: number): number =>
  Math.min(LOGIN_BONUS_BASE + (streak - 1) * LOGIN_BONUS_STEP, LOGIN_BONUS_CAP);

// 受取済みの記録を返す形（当日分・競合時の既存行どちらも同じ応答）。
const existingClaim = async (
  db: D1Database,
  userId: string,
  day: string,
  row: LoginBonusRow,
): Promise<LoginBonusResult> => {
  const balanceRow = await db
    .prepare("SELECT balance FROM v2_currency_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  return {
    claimed: false,
    day,
    streak: row.streak,
    amount: row.amount,
    balance: balanceRow?.balance ?? 0,
  };
};

// ログイン特典（1日1回・連続で増量）。user_id×day の一意で同日の二重受取は起きない。
// 切替前の記録は day が UTC 日付なので、day の一致だけでは同じ JST 日の受取を見落とす。
// created_at が当日の JST 範囲に入る行も受取済みとみなし、連続日数も created_at の JST 日で数える。
export const claimLoginBonus = async (
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<LoginBonusResult> => {
  const day = jstDateKey(now);
  const existing = await todayBonus(db, userId, day, jstDayStartMs(now));
  if (existing) return existingClaim(db, userId, day, existing);
  const last = await lastLoginBonus(db, userId);
  const streak =
    last && jstDateKey(last.created_at) === jstDateKey(now - DAY_MS) ? last.streak + 1 : 1;
  // プランの通貨ボーナスレートを特典額へ掛ける（RIT-193 の機能差適用点）。
  const rate = (await readPlan(db, userId, now)).features.currencyBonusRate;
  const amount = Math.round(loginBonusAmount(streak) * rate);
  const granted = await bonusCurrency(db, {
    userId,
    amount,
    reason: `ログイン特典（${streak}日連続）`,
    refType: "login-bonus",
    refId: day,
    idempotencyKey: `login:${userId}:${day}`,
  });
  try {
    await db
      .prepare(
        "INSERT INTO v2_login_bonus (id, user_id, day, streak, amount, ledger_id, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), userId, day, streak, amount, granted.entry.id, now)
      .run();
  } catch {
    // 同時受取の競合: 台帳は冪等キーで1行、受取記録だけ一意違反になる。
    // 既に入った側の記録を返し、呼び出し元には「当日受取済み」を返す。
    const winner = await todayBonus(db, userId, day, jstDayStartMs(now));
    if (winner) return existingClaim(db, userId, day, winner);
    throw new Error("v2_login_bonus への挿入に失敗しました");
  }
  return { claimed: true, day, streak, amount, balance: granted.balance };
};

export interface AdRewardResult {
  rewarded: boolean;
  amount: number;
  balance: number;
}

// 広告視聴報酬。視聴完了の attemptId 単位で冪等（同じ視聴を何度通知しても一回だけ）。
export const recordAdReward = async (
  db: D1Database,
  input: { userId: string; attemptId: string },
): Promise<AdRewardResult> => {
  const rate = (await readPlan(db, input.userId)).features.currencyBonusRate;
  const amount = Math.round(AD_REWARD_AMOUNT * rate);
  const result = await bonusCurrency(db, {
    userId: input.userId,
    amount,
    reason: "広告視聴報酬",
    refType: "ad",
    refId: input.attemptId,
    idempotencyKey: `ad:${input.userId}:${input.attemptId}`,
  });
  return { rewarded: !result.replayed, amount, balance: result.balance };
};

export interface DailyPassResult {
  active: boolean;
  expiresAt: number | null;
  // この呼び出しで新規に購入したか（有効券がある間は課金しない）。
  charged: boolean;
  balance: number;
}

const activePass = async (
  db: D1Database,
  userId: string,
  now: number,
): Promise<{ expiresAt: number } | null> => {
  const row = await db
    .prepare(
      "SELECT expires_at FROM v2_feature_pass WHERE user_id = ? AND kind = 'daily' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1",
    )
    .bind(userId, now)
    .first<{ expires_at: number }>();
  return row ? { expiresAt: Number(row.expires_at) } : null;
};

// 1日券: spend 100 → 24時間の機能解放。有効券がある間は課金せず現行券を返す。
// 購入冪等は pass:{user}:{day} — 1日券を同日に2枚買う商品設計は無い。
export const activateDailyPass = async (
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<DailyPassResult> => {
  const current = await activePass(db, userId, now);
  if (current) {
    const balanceRow = await db
      .prepare("SELECT balance FROM v2_currency_balance WHERE user_id = ?")
      .bind(userId)
      .first<{ balance: number }>();
    return {
      active: true,
      expiresAt: current.expiresAt,
      charged: false,
      balance: balanceRow?.balance ?? 0,
    };
  }
  // 初回の消費行動が1日券購入でも生成と同じくシードを付与してから課金する。
  await ensureSeedBalance(db, userId);
  const spent = await spendCurrency(db, {
    userId,
    amount: DAILY_PASS_COST,
    reason: "1日券",
    refType: "feature-pass",
    refId: jstDateKey(now),
    idempotencyKey: `pass:${userId}:${jstDateKey(now)}`,
  });
  if (spent.replayed) {
    // 同日購入の再送/競合: 課金は1回のみ。発行済みの券があればそれを返し、
    // 券発行前に落ちていた場合だけ同じ課金行で券を発行する。
    const issued = await activePass(db, userId, now);
    if (issued) {
      return { active: true, expiresAt: issued.expiresAt, charged: false, balance: spent.balance };
    }
  }
  const expiresAt = now + DAILY_PASS_HOURS * 3_600_000;
  await db
    .prepare(
      "INSERT INTO v2_feature_pass (id, user_id, kind, ledger_id, started_at, expires_at, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), userId, "daily", spent.entry.id, now, expiresAt, Date.now())
    .run();
  return { active: true, expiresAt, charged: true, balance: spent.balance };
};

export const readDailyPass = async (
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<DailyPassResult> => {
  const current = await activePass(db, userId, now);
  if (!current) return { active: false, expiresAt: null, charged: false, balance: 0 };
  const balanceRow = await db
    .prepare("SELECT balance FROM v2_currency_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  return {
    active: true,
    expiresAt: current.expiresAt,
    charged: false,
    balance: balanceRow?.balance ?? 0,
  };
};
