// 通貨台帳（RIT-191）。全ての増減は v2_currency_ledger へ1行記録し、
// v2_currency_balance の残高は台帳挿入と同一バッチで更新する（D1 batch は原子性を持つ）。
// idempotency_key は一意制約で二重計上を防ぐ。amount は常に正の最小単位で、
// 増減方向は kind（spend のみ減算）で決まる。生成失敗返金（RIT-188）は
// ref_type="generation" / ref_id=<generation id> で台帳へ繋ぐ。
export class CurrencyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CurrencyError";
    this.status = status;
  }
}

export const CURRENCY_KINDS = ["grant", "purchase", "spend", "refund", "bonus"] as const;
export type CurrencyKind = (typeof CURRENCY_KINDS)[number];

export interface CurrencyLedgerRow {
  id: string;
  user_id: string;
  kind: CurrencyKind;
  amount: number;
  balance_after: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  idempotency_key: string;
  created_at: number;
}

interface CurrencyBalanceRow {
  balance: number;
}

export interface LedgerEntryInput {
  userId: string;
  kind: CurrencyKind;
  amount: number;
  reason: string;
  refType?: string;
  refId?: string;
  idempotencyKey: string;
}

export interface LedgerApplyResult {
  entry: CurrencyLedgerRow;
  balance: number;
  // 既存の idempotency_key に一致した再送は true（二重計上なしで同じ結果を返す）。
  replayed: boolean;
}

const toRow = (row: Record<string, unknown>): CurrencyLedgerRow => ({
  id: String(row.id),
  user_id: String(row.user_id),
  kind: row.kind as CurrencyKind,
  amount: Number(row.amount),
  balance_after: Number(row.balance_after),
  reason: String(row.reason),
  ref_type: row.ref_type === null || row.ref_type === undefined ? null : String(row.ref_type),
  ref_id: row.ref_id === null || row.ref_id === undefined ? null : String(row.ref_id),
  idempotency_key: String(row.idempotency_key),
  created_at: Number(row.created_at),
});

const readBalance = async (db: D1Database, userId: string): Promise<number> => {
  const row = await db
    .prepare("SELECT balance FROM v2_currency_balance WHERE user_id = ?")
    .bind(userId)
    .first<CurrencyBalanceRow>();
  return row ? Number(row.balance) : 0;
};

const findByIdempotencyKey = async (
  db: D1Database,
  idempotencyKey: string,
): Promise<CurrencyLedgerRow | null> => {
  const row = await db
    .prepare("SELECT * FROM v2_currency_ledger WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first<Record<string, unknown>>();
  return row ? toRow(row) : null;
};

// 台帳行と残高を同一バッチで書く（D1 batch の原子性に乗せる）。
const insertEntry = async (
  db: D1Database,
  input: LedgerEntryInput,
  balanceAfter: number,
): Promise<CurrencyLedgerRow> => {
  const entry: CurrencyLedgerRow = {
    id: crypto.randomUUID(),
    user_id: input.userId,
    kind: input.kind,
    amount: input.amount,
    balance_after: balanceAfter,
    reason: input.reason,
    ref_type: input.refType ?? null,
    ref_id: input.refId ?? null,
    idempotency_key: input.idempotencyKey,
    created_at: Date.now(),
  };
  await db.batch([
    db
      .prepare(
        "INSERT INTO v2_currency_ledger (id, user_id, kind, amount, balance_after, reason, ref_type, ref_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        entry.id,
        entry.user_id,
        entry.kind,
        entry.amount,
        entry.balance_after,
        entry.reason,
        entry.ref_type,
        entry.ref_id,
        entry.idempotency_key,
        entry.created_at,
      ),
    db
      .prepare(
        "INSERT INTO v2_currency_balance (user_id, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at",
      )
      .bind(entry.user_id, balanceAfter, entry.created_at),
  ]);
  return entry;
};

// 台帳への記録。同じ idempotency_key の再送は既存行をそのまま返す（残高は変わらない）。
// spend は残高不足なら 409 で何も書かない。付与系（grant/purchase/refund/bonus）は加算。
export const applyLedgerEntry = async (
  db: D1Database,
  input: LedgerEntryInput,
): Promise<LedgerApplyResult> => {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new CurrencyError("amount は正の整数で指定してください。", 400);
  }
  const existing = await findByIdempotencyKey(db, input.idempotencyKey);
  if (existing) {
    return { entry: existing, balance: existing.balance_after, replayed: true };
  }
  const current = await readBalance(db, input.userId);
  if (input.kind === "spend" && current < input.amount) {
    throw new CurrencyError("残高が不足しています。", 409);
  }
  const delta = input.kind === "spend" ? -input.amount : input.amount;
  const entry = await insertEntry(db, input, current + delta);
  return { entry, balance: entry.balance_after, replayed: false };
};

export const grantCurrency = (
  db: D1Database,
  input: Omit<LedgerEntryInput, "kind">,
): Promise<LedgerApplyResult> => applyLedgerEntry(db, { ...input, kind: "grant" });

export const spendCurrency = (
  db: D1Database,
  input: Omit<LedgerEntryInput, "kind">,
): Promise<LedgerApplyResult> => applyLedgerEntry(db, { ...input, kind: "spend" });

export const refundCurrency = (
  db: D1Database,
  input: Omit<LedgerEntryInput, "kind">,
): Promise<LedgerApplyResult> => applyLedgerEntry(db, { ...input, kind: "refund" });

export interface CurrencyStatus {
  balance: number;
  entries: CurrencyLedgerRow[];
}

// GET /api/currency の本体。残高＋直近の台帳（新しい順、既定50件）を返す。
export const readCurrencyStatus = async (
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<CurrencyStatus> => {
  const balance = await readBalance(db, userId);
  const rows = await db
    .prepare(
      "SELECT * FROM v2_currency_ledger WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .bind(userId, limit)
    .all<Record<string, unknown>>();
  return { balance, entries: (rows.results ?? []).map(toRow) };
};
