// RIT-191: 通貨台帳の確かめ — 実 D1 で、grant/spend/refund が残高と台帳へ同一バッチで
// 記録されること、残高不足は 409 で何も書かれないこと、idempotency_key の再送が
// 二重計上にならず同じ結果を返すこと、GET /api/currency の面を見る。
// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import {
  applyLedgerEntry,
  CurrencyError,
  grantCurrency,
  readCurrencyStatus,
  refundCurrency,
  spendCurrency,
  type CurrencyLedgerRow,
} from "./currency";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleCurrencyStatusRequest } = await import("./api-currency");

let local: LocalD1;
const user = () => `u-${randomUUID()}`;

const ledgerRows = async (userId: string): Promise<CurrencyLedgerRow[]> => {
  const rows = await local.d1
    .prepare("SELECT * FROM v2_currency_ledger WHERE user_id = ? ORDER BY created_at, id")
    .bind(userId)
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
  platform.env = { DB: local.d1 };
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

describe("applyLedgerEntry", () => {
  it("grant が台帳と残高へ同一記録され balance_after が一致する", async () => {
    const userId = user();
    const first = await grantCurrency(local.d1, {
      userId,
      amount: 500,
      reason: "初期付与",
      idempotencyKey: `g-${randomUUID()}`,
    });
    expect(first.balance).toBe(500);
    expect(first.entry.balance_after).toBe(500);
    expect(first.replayed).toBe(false);
    const second = await grantCurrency(local.d1, {
      userId,
      amount: 300,
      reason: "追加付与",
      idempotencyKey: `g-${randomUUID()}`,
    });
    expect(second.balance).toBe(800);
    expect(second.entry.balance_after).toBe(800);
    expect(await balanceOf(userId)).toBe(800);
    const rows = await ledgerRows(userId);
    expect(rows).toHaveLength(2);
    expect(rows[1].balance_after).toBe(800);
  });

  it("spend は残高を減らし、refund は generation 参照つきで戻す", async () => {
    const userId = user();
    await grantCurrency(local.d1, {
      userId,
      amount: 1000,
      reason: "付与",
      idempotencyKey: `g-${randomUUID()}`,
    });
    const spent = await spendCurrency(local.d1, {
      userId,
      amount: 400,
      reason: "画像生成",
      refType: "generation",
      refId: "gen-1",
      idempotencyKey: `s-${randomUUID()}`,
    });
    expect(spent.balance).toBe(600);
    expect(spent.entry.kind).toBe("spend");
    const refunded = await refundCurrency(local.d1, {
      userId,
      amount: 400,
      reason: "生成失敗の返却",
      refType: "generation",
      refId: "gen-1",
      idempotencyKey: `r-${randomUUID()}`,
    });
    expect(refunded.balance).toBe(1000);
    expect(refunded.entry.ref_type).toBe("generation");
    expect(refunded.entry.ref_id).toBe("gen-1");
    const kinds = (await ledgerRows(userId)).map((row) => row.kind);
    expect(kinds).toEqual(["grant", "spend", "refund"]);
  });

  it("残高不足の spend は 409 で、台帳にも残高にも触れない", async () => {
    const userId = user();
    await grantCurrency(local.d1, {
      userId,
      amount: 100,
      reason: "付与",
      idempotencyKey: `g-${randomUUID()}`,
    });
    const key = `s-${randomUUID()}`;
    await expect(
      spendCurrency(local.d1, {
        userId,
        amount: 150,
        reason: "消費",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ status: 409, name: "CurrencyError" });
    expect(await balanceOf(userId)).toBe(100);
    expect(await ledgerRows(userId)).toHaveLength(1);
    // 409 になったキーを再送しても残高不足のまま（行は増えない）
    await expect(
      spendCurrency(local.d1, {
        userId,
        amount: 150,
        reason: "消費",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await ledgerRows(userId)).toHaveLength(1);
  });

  it("同じ idempotency_key の再送は既存行を返し二重計上しない", async () => {
    const userId = user();
    const key = `g-${randomUUID()}`;
    const first = await grantCurrency(local.d1, {
      userId,
      amount: 200,
      reason: "付与",
      idempotencyKey: key,
    });
    const replay = await grantCurrency(local.d1, {
      userId,
      amount: 200,
      reason: "付与",
      idempotencyKey: key,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.entry.id).toBe(first.entry.id);
    expect(await balanceOf(userId)).toBe(200);
    expect(await ledgerRows(userId)).toHaveLength(1);
  });

  it("amount が 0 以下・非整数なら 400 で何も書かない", async () => {
    const userId = user();
    for (const amount of [0, -10, 1.5]) {
      await expect(
        applyLedgerEntry(local.d1, {
          userId,
          kind: "grant",
          amount,
          reason: "不正",
          idempotencyKey: `g-${randomUUID()}`,
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(await ledgerRows(userId)).toHaveLength(0);
    await expect(
      applyLedgerEntry(local.d1, {
        userId,
        kind: "bogus" as never,
        amount: 10,
        reason: "不正",
        idempotencyKey: `g-${randomUUID()}`,
      }),
    ).rejects.toThrow();
    expect(await ledgerRows(userId)).toHaveLength(0);
  });

  it("残高が負になる書き込みは DB の CHECK で弾かれる", async () => {
    const userId = user();
    await expect(
      local.d1
        .prepare("INSERT INTO v2_currency_balance (user_id, balance, updated_at) VALUES (?, -1, ?)")
        .bind(userId, Date.now())
        .run(),
    ).rejects.toThrow();
  });
});

describe("readCurrencyStatus / GET /api/currency", () => {
  it("残高と新しい順の台帳を返す", async () => {
    const userId = "local";
    // local ユーザーに専用キーで付与（他テストと共有されうるため追加分だけ見る）
    const key = `g-${randomUUID()}`;
    const before = await balanceOf(userId);
    await grantCurrency(local.d1, {
      userId,
      amount: 123,
      reason: "status確かめ",
      idempotencyKey: key,
    });
    const status = await readCurrencyStatus(local.d1, userId);
    expect(status.balance).toBe(before + 123);
    expect(status.entries[0].idempotency_key).toBe(key);
    for (let i = 1; i < status.entries.length; i += 1) {
      expect(status.entries[i - 1].created_at).toBeGreaterThanOrEqual(status.entries[i].created_at);
    }
  });

  it("GET /api/currency が local ユーザーの残高と台帳を 200 で返す", async () => {
    const response = await handleCurrencyStatusRequest(
      new Request("https://example.com/api/currency"),
    );
    expect(response.status).toBe(200);
    const body: { balance: number; entries: CurrencyLedgerRow[] } = await response.json();
    expect(typeof body.balance).toBe("number");
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

// CurrencyError は status 持ちの Error として API 写像へ渡せる形。
describe("CurrencyError", () => {
  it("status と name を持つ", () => {
    const error = new CurrencyError("x", 409);
    expect(error.status).toBe(409);
    expect(error.name).toBe("CurrencyError");
  });
});
