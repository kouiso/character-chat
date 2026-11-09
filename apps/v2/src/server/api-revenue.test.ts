// RIT-195 収益集計 API の検証（インメモリ D1 フェイク）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  ledger: [] as {
    id: string;
    user_id: string;
    kind: string;
    amount: number;
    ref_id: string | null;
  }[],
  revenue: new Map<
    string,
    {
      user_id: string;
      source_type: string;
      ref_id: string | null;
      gross: number;
      share: number;
      created_at: number;
    }
  >(),
};

const runStatement = (sql: string, binds: unknown[]) => {
  if (sql.startsWith("INSERT OR IGNORE INTO v2_creator_revenue")) {
    const sourceLedgerId = String(binds[2]);
    if (state.revenue.has(sourceLedgerId)) return;
    state.revenue.set(sourceLedgerId, {
      user_id: String(binds[1]),
      source_type: String(binds[3]),
      ref_id: binds[4] === null ? null : String(binds[4]),
      gross: Number(binds[5]),
      share: Number(binds[6]),
      created_at: Number(binds[7]),
    });
    return;
  }
  throw new Error(`unhandled run: ${sql}`);
};

const queryStatement = (sql: string, binds: unknown[]) => {
  if (sql.includes("FROM v2_currency_ledger l") && sql.includes("kind = 'tip'")) {
    return state.ledger.filter((row) => row.kind === "tip" && !state.revenue.has(row.id));
  }
  if (sql.includes("FROM v2_creator_revenue WHERE user_id = ?")) {
    return [...state.revenue.entries()]
      .filter(([, row]) => row.user_id === String(binds[0]))
      .map(([id, row]) => ({
        id,
        source_type: row.source_type,
        ref_id: row.ref_id,
        gross_amount: row.gross,
        share_amount: row.share,
        created_at: row.created_at,
      }));
  }
  throw new Error(`unhandled query: ${sql}`);
};

vi.mock("./platform", () => ({
  getPlatform: async () => ({
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...binds: unknown[]) => ({
            run: async () => {
              runStatement(sql, binds);
              return {};
            },
            first: async () => queryStatement(sql, binds),
            all: async () => ({ results: queryStatement(sql, binds) }),
          }),
          all: async () => ({ results: queryStatement(sql, []) }),
        }),
        batch: async (stmts: { run: () => Promise<object> }[]) => {
          for (const stmt of stmts) await stmt.run();
          return [];
        },
      },
    },
  }),
}));

const { handleRevenueAggregate, handleRevenueList } = await import("./api-revenue");
const { LOCAL_USER_ID } = await import("./identity");

const seedTip = (id: string, amount: number) => {
  state.ledger.push({
    id,
    user_id: LOCAL_USER_ID,
    kind: "tip",
    amount,
    ref_id: "char-1",
  });
};

describe("クリエイター収益集計", () => {
  beforeEach(() => {
    state.ledger.length = 0;
    state.revenue.clear();
  });

  it("tip 行から50%の収益行が積まれる", async () => {
    seedTip("l1", 200);
    const res = await handleRevenueAggregate();
    expect(res.status).toBe(200);
    const { aggregated }: { aggregated: number } = await res.json();
    expect(aggregated).toBe(1);
    const list = await handleRevenueList();
    const body: { items: { shareAmount: number; grossAmount: number; sourceType: string }[] } =
      await list.json();
    expect(body.items[0]).toMatchObject({ grossAmount: 200, shareAmount: 100, sourceType: "tip" });
  });

  it("集計は冪等（同じ台帳行は二度積まない）", async () => {
    seedTip("l1", 100);
    await handleRevenueAggregate();
    const second: { aggregated: number } = await (await handleRevenueAggregate()).json();
    expect(second.aggregated).toBe(0);
    expect(state.revenue.size).toBe(1);
  });

  it("tip 以外の kind は集計対象外", async () => {
    state.ledger.push(
      { id: "s1", user_id: LOCAL_USER_ID, kind: "spend", amount: 100, ref_id: "char-1" },
      { id: "g1", user_id: LOCAL_USER_ID, kind: "grant", amount: 50, ref_id: null },
    );
    const res: { aggregated: number } = await (await handleRevenueAggregate()).json();
    expect(res.aggregated).toBe(0);
  });

  it("収益一覧は合計を返す（支払い元データ）", async () => {
    seedTip("l1", 200);
    seedTip("l2", 101);
    await handleRevenueAggregate();
    const res = await handleRevenueList();
    const body: { totalGross: number; totalShare: number; items: unknown[] } = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.totalGross).toBe(301);
    expect(body.totalShare).toBe(150);
  });
});
