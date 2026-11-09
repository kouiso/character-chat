// 月額プラン（RIT-193）。free/standard/premium の段階・有効期限・機能差を
// v2_subscription に持ち、期限切れ・解約は free へ落ちる。購入は当面通貨 spend で
// 行い、実決済（RIT-192）は ledger_id 経由で後付けできる構造にしておく。
import { spendCurrency } from "./currency";
import { ensureSeedBalance } from "./generation-billing";

export type Plan = "free" | "standard" | "premium";

export interface PlanFeatures {
  // 記憶検索の深さ（Vectorize topK）。記憶力向上の機能差。
  memoryTopK: number;
  // 特典・報酬の台帳付与量に掛ける倍率（通貨ボーナスレート）。
  currencyBonusRate: number;
  // 30日分の通貨価格。
  monthlyCost: number;
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: { memoryTopK: 10, currencyBonusRate: 1, monthlyCost: 0 },
  standard: { memoryTopK: 30, currencyBonusRate: 1.1, monthlyCost: 500 },
  premium: { memoryTopK: 60, currencyBonusRate: 1.25, monthlyCost: 2000 },
};

const SUBSCRIPTION_DAYS = 30;
const DAY_MS = 86_400_000;
const dayOf = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

interface SubscriptionRow {
  plan: Plan;
  started_at: number;
  expires_at: number | null;
  cancelled_at: number | null;
}

export interface PlanStatus {
  plan: Plan;
  features: PlanFeatures;
  expiresAt: number | null;
  // 期限切れ or 解約済みで現在の段階が実質 free かどうかではなく、契約が有効か。
  active: boolean;
  cancelled: boolean;
}

const loadSubscription = async (
  db: D1Database,
  userId: string,
): Promise<SubscriptionRow | null> => {
  const row = await db
    .prepare(
      "SELECT plan, started_at, expires_at, cancelled_at FROM v2_subscription WHERE user_id = ?",
    )
    .bind(userId)
    .first<Record<string, unknown>>();
  return row
    ? {
        plan: row.plan as Plan,
        started_at: Number(row.started_at),
        expires_at: row.expires_at === null ? null : Number(row.expires_at),
        cancelled_at: row.cancelled_at === null ? null : Number(row.cancelled_at),
      }
    : null;
};

const toStatus = (row: SubscriptionRow | null, now: number): PlanStatus => {
  const active = row !== null && row.plan !== "free" && (row.expires_at ?? 0) > now;
  const plan = active ? row.plan : "free";
  return {
    plan,
    features: PLAN_FEATURES[plan],
    expiresAt: active ? row.expires_at : null,
    active,
    cancelled: row?.cancelled_at !== null && row?.cancelled_at !== undefined,
  };
};

// 現在の有効プランを読む。未契約・期限切れは free 相当を返す。
export const readPlan = async (
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<PlanStatus> => toStatus(await loadSubscription(db, userId), now);

export interface ActivatePlanResult extends PlanStatus {
  // この呼び出しで新たに課金したか（同日同プランの再送・同段階の継続中は課金しない）。
  charged: boolean;
  balance: number;
}

const balanceOf = async (db: D1Database, userId: string): Promise<number> => {
  const row = await db
    .prepare("SELECT balance FROM v2_currency_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
};

// プランを有効化する。同段階の有効契約がある間は課金せず現行を返す。
// 別段階への切替・同日再送は plan:{user}:{plan}:{day} の冪等キーで処理する。
export const activatePlan = async (
  db: D1Database,
  userId: string,
  target: Plan,
  now = Date.now(),
): Promise<ActivatePlanResult> => {
  const current = toStatus(await loadSubscription(db, userId), now);
  if (current.plan === target && current.active) {
    return { ...current, charged: false, balance: await balanceOf(db, userId) };
  }
  const cost = PLAN_FEATURES[target].monthlyCost;
  let ledgerId: string | null = null;
  let balance = await balanceOf(db, userId);
  if (cost > 0) {
    await ensureSeedBalance(db, userId);
    const spent = await spendCurrency(db, {
      userId,
      amount: cost,
      reason: `${target}プラン（30日）`,
      refType: "subscription",
      refId: target,
      idempotencyKey: `plan:${userId}:${target}:${dayOf(now)}`,
    });
    ledgerId = spent.entry.id;
    balance = spent.balance;
    if (spent.replayed && current.plan === target) {
      // 同日再送: 課金行は1つのみ。既存の契約行を返す。
      return { ...current, charged: false, balance };
    }
  }
  // 継続中の契約があれば残期間の上に積む（更新）。なければ今から30日。
  const base = current.active && current.plan === target ? (current.expiresAt ?? now) : now;
  const expiresAt = base + SUBSCRIPTION_DAYS * DAY_MS;
  await db
    .prepare(
      "INSERT INTO v2_subscription (user_id, plan, started_at, expires_at, ledger_id, cancelled_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan, started_at=excluded.started_at, expires_at=excluded.expires_at, ledger_id=excluded.ledger_id, cancelled_at=NULL, updated_at=excluded.updated_at",
    )
    .bind(userId, target, now, expiresAt, ledgerId, null, now)
    .run();
  const next = toStatus(await loadSubscription(db, userId), now);
  return { ...next, charged: cost > 0, balance };
};

// 解約は「期限で落ちる」意思表示。段階は expires_at まで保持される。
export const cancelPlan = async (
  db: D1Database,
  userId: string,
  now = Date.now(),
): Promise<PlanStatus> => {
  const current = await loadSubscription(db, userId);
  if (current && current.cancelled_at === null) {
    await db
      .prepare("UPDATE v2_subscription SET cancelled_at = ?, updated_at = ? WHERE user_id = ?")
      .bind(now, now, userId)
      .run();
  }
  return toStatus(await loadSubscription(db, userId), now);
};
