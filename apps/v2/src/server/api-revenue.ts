// クリエイター収益還元 API（RIT-195）。台帳の kind='tip' 行（作者側受取）から
// 50%還元分を v2_creator_revenue へ積む。source_ledger_id 一意で集計は冪等。
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const REVENUE_SHARE_RATE = 0.5;

// POST /api/revenue/aggregate — 台帳の tip 行を走査し未集計分の収益行を積む。
// 有料コンテンツ等の将来の収益イベントもここで拾う拡張点（ref_type で分岐）。
export const handleRevenueAggregate = async (): Promise<Response> => {
  const { env } = await getPlatform();
  const { results } = await env.DB.prepare(
    "SELECT l.id, l.user_id, l.amount, l.ref_id FROM v2_currency_ledger l " +
      "WHERE l.kind = 'tip' AND NOT EXISTS " +
      "(SELECT 1 FROM v2_creator_revenue r WHERE r.source_ledger_id = l.id)",
  ).all<{ id: string; user_id: string; amount: number; ref_id: string | null }>();
  const rows = results ?? [];
  const now = Date.now();
  const statements = rows.map((row) =>
    env.DB.prepare(
      "INSERT OR IGNORE INTO v2_creator_revenue (id, user_id, source_ledger_id, source_type, ref_id, gross_amount, share_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      row.user_id,
      row.id,
      "tip",
      row.ref_id,
      row.amount,
      Math.floor(row.amount * REVENUE_SHARE_RATE),
      now,
    ),
  );
  if (statements.length > 0) await env.DB.batch(statements);
  return json(200, { aggregated: rows.length });
};

// GET /api/revenue — 自分の収益一覧と合計（支払い申請の元データ）。
export const handleRevenueList = async (): Promise<Response> => {
  const { env } = await getPlatform();
  const { results } = await env.DB.prepare(
    "SELECT id, source_type, ref_id, gross_amount, share_amount, created_at " +
      "FROM v2_creator_revenue WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(LOCAL_USER_ID)
    .all<{
      id: string;
      source_type: string;
      ref_id: string | null;
      gross_amount: number;
      share_amount: number;
      created_at: number;
    }>();
  const items = (results ?? []).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    refId: row.ref_id,
    grossAmount: row.gross_amount,
    shareAmount: row.share_amount,
    createdAt: row.created_at,
  }));
  return json(200, {
    items,
    totalGross: items.reduce((sum, row) => sum + row.grossAmount, 0),
    totalShare: items.reduce((sum, row) => sum + row.shareAmount, 0),
  });
};
