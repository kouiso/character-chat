// RIT-188: 生成課金の確かめ — charge→refund の台帳往復、シード付与の一回性、
// 残高不足 409、返金の冪等を実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { spendCurrency, type CurrencyLedgerRow } from "./currency";
import {
  chargeGeneration,
  ensureSeedBalance,
  GENERATION_COST,
  INITIAL_GRANT,
  refundGeneration,
} from "./generation-billing";

let local: LocalD1;
const user = () => `u-${crypto.randomUUID()}`;
const gen = () => `gen-${crypto.randomUUID()}`;

const rowsFor = async (generationId: string): Promise<CurrencyLedgerRow[]> => {
  const rows = await local.d1
    .prepare(
      "SELECT * FROM v2_currency_ledger WHERE ref_type = 'generation' AND ref_id = ? ORDER BY created_at, id",
    )
    .bind(generationId)
    .all<Record<string, unknown>>();
  return (rows.results ?? []) as unknown as CurrencyLedgerRow[];
};

const balanceOf = async (userId: string): Promise<number> => {
  const row = await local.d1
    .prepare("SELECT balance FROM v2_currency_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  return row ? row.balance : 0;
};

beforeAll(async () => {
  local = await openLocalD1();
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

describe("chargeGeneration / refundGeneration", () => {
  it("初回 charge はシード付与のあと spend を記録する", async () => {
    const userId = user();
    const generationId = gen();
    await chargeGeneration(local.d1, { userId, generationId, kind: "image" });
    expect(await balanceOf(userId)).toBe(INITIAL_GRANT - GENERATION_COST.image);
    const rows = await rowsFor(generationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("spend");
    expect(rows[0].amount).toBe(GENERATION_COST.image);
    expect(rows[0].ref_id).toBe(generationId);
  });

  it("失敗時の refund は charge と同額・同じ生成参照で残高へ戻る", async () => {
    const userId = user();
    const generationId = gen();
    await chargeGeneration(local.d1, { userId, generationId, kind: "video" });
    await refundGeneration(local.d1, { userId, generationId, kind: "video" });
    expect(await balanceOf(userId)).toBe(INITIAL_GRANT);
    const rows = await rowsFor(generationId);
    expect(rows.map((row) => row.kind)).toEqual(["spend", "refund"]);
    // 成功時は charge のみ — refund を呼ばん限り返却行は生まれん
    const other = gen();
    await chargeGeneration(local.d1, { userId, generationId: other, kind: "image" });
    expect((await rowsFor(other)).map((row) => row.kind)).toEqual(["spend"]);
  });

  it("refund の再送・重複呼出しは二重返却しない", async () => {
    const userId = user();
    const generationId = gen();
    await chargeGeneration(local.d1, { userId, generationId, kind: "image" });
    await refundGeneration(local.d1, { userId, generationId, kind: "image" });
    await refundGeneration(local.d1, { userId, generationId, kind: "image" });
    expect((await rowsFor(generationId)).map((row) => row.kind)).toEqual(["spend", "refund"]);
    expect(await balanceOf(userId)).toBe(INITIAL_GRANT);
  });

  it("残高が足りなければ charge は 409 で何も記録しない", async () => {
    const userId = user();
    await ensureSeedBalance(local.d1, userId);
    // シードを使い切って残 5 にしてから video(50) を請求する
    await spendCurrency(local.d1, {
      userId,
      amount: INITIAL_GRANT - 5,
      reason: "テスト用の消費",
      idempotencyKey: `drain-${crypto.randomUUID()}`,
    });
    const generationId = gen();
    await expect(
      chargeGeneration(local.d1, { userId, generationId, kind: "video" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await rowsFor(generationId)).toHaveLength(0);
    expect(await balanceOf(userId)).toBe(5);
  });

  it("シード付与は何度呼んでも一度だけ", async () => {
    const userId = user();
    await ensureSeedBalance(local.d1, userId);
    await ensureSeedBalance(local.d1, userId);
    expect(await balanceOf(userId)).toBe(INITIAL_GRANT);
  });
});
