// RIT-208 贈与 API の検証。台帳・残高をインメモリで持ち、実際の SQL 経路を通す。
import { beforeEach, describe, expect, it, vi } from "vitest";

interface LedgerRow {
  id: string;
  user_id: string;
  kind: string;
  amount: number;
  balance_after: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  idempotency_key: string;
  created_at: number;
}

const state = {
  publish: new Map<string, { user_id: string }>(),
  ledger: [] as LedgerRow[],
  balance: new Map<string, number>(),
};

const insertLedger = (binds: unknown[]) => {
  state.ledger.push({
    id: String(binds[0]),
    user_id: String(binds[1]),
    kind: String(binds[2]),
    amount: Number(binds[3]),
    balance_after: Number(binds[4]),
    reason: String(binds[5]),
    ref_type: binds[6] === null ? null : String(binds[6]),
    ref_id: binds[7] === null ? null : String(binds[7]),
    idempotency_key: String(binds[8]),
    created_at: Number(binds[9]),
  });
};

const upsertBalance = (binds: unknown[]) => {
  state.balance.set(String(binds[0]), Number(binds[1]));
};

const runStatement = (sql: string, binds: unknown[]) => {
  if (sql.startsWith("INSERT INTO v2_currency_ledger")) {
    if (state.ledger.some((row) => row.idempotency_key === String(binds[8])))
      throw new Error("UNIQUE constraint failed");
    insertLedger(binds);
    return;
  }
  if (sql.startsWith("INSERT INTO v2_currency_balance")) {
    upsertBalance(binds);
    return;
  }
  throw new Error(`unhandled run: ${sql}`);
};

const queryStatement = (sql: string, binds: unknown[]) => {
  if (sql.includes("FROM v2_character_publish")) {
    return state.publish.get(String(binds[0])) ?? null;
  }
  if (sql.startsWith("SELECT balance FROM v2_currency_balance")) {
    const balance = state.balance.get(String(binds[0]));
    return balance === undefined ? null : { balance };
  }
  if (sql.includes("FROM v2_currency_ledger WHERE idempotency_key = ?")) {
    return state.ledger.find((row) => row.idempotency_key === String(binds[0])) ?? null;
  }
  throw new Error(`unhandled query: ${sql}`);
};

// db.prepare(sql).bind(...) が batch 配列に渡る形を模す。__run は batch 用、
// run/first/all は直接呼び用。
const fakeDbWithBatch = {
  prepare: (sql: string) => ({
    bind: (...binds: unknown[]) => ({
      __run: () => runStatement(sql, binds),
      run: async () => {
        runStatement(sql, binds);
        return {};
      },
      first: async () => queryStatement(sql, binds),
      all: async () => ({ results: [] }),
    }),
  }),
  batch: async (stmts: { __run?: () => void; run?: () => Promise<object> }[]) => {
    const results = [];
    for (const stmt of stmts) {
      if (stmt.__run) {
        stmt.__run();
        results.push({});
      } else if (stmt.run) {
        results.push(await stmt.run());
      }
    }
    return results;
  },
};

vi.mock("./platform", () => ({
  getPlatform: async () => ({ env: { DB: fakeDbWithBatch } }),
}));

const { handleTip } = await import("./api-tip");
const { grantCurrency } = await import("./currency");
const { LOCAL_USER_ID } = await import("./identity");

const post = (body: unknown) =>
  new Request("https://example.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const grant = async (userId: string, amount: number, key: string) => {
  await grantCurrency(fakeDbWithBatch as unknown as D1Database, {
    userId,
    amount,
    reason: "テスト付与",
    idempotencyKey: key,
  });
};

describe("クリエイターへの贈与", () => {
  beforeEach(() => {
    state.publish.clear();
    state.ledger.length = 0;
    state.balance.clear();
    state.publish.set("char-1", { user_id: "author-1" });
  });

  it("贈与で送り手が減り作者が増え、kind=tip が作者側に立つ", async () => {
    await grant(LOCAL_USER_ID, 500, "g1");
    const res = await handleTip("char-1", post({ amount: 200, idempotencyKey: "tipkey-0001" }));
    expect(res.status).toBe(201);
    const body: { senderBalance: number } = await res.json();
    expect(body.senderBalance).toBe(300);
    expect(state.balance.get("author-1")).toBe(200);
    const authorRow = state.ledger.find((row) => row.user_id === "author-1" && row.kind === "tip");
    expect(authorRow).toMatchObject({ amount: 200, balance_after: 200, ref_id: "char-1" });
    const senderRow = state.ledger.find(
      (row) => row.user_id === LOCAL_USER_ID && row.kind === "spend",
    );
    expect(senderRow?.ref_type).toBe("tip");
  });

  it("同じ idempotencyKey の再送は二重計上しない", async () => {
    await grant(LOCAL_USER_ID, 300, "g1");
    const req = () => post({ amount: 100, idempotencyKey: "tipkey-0002" });
    await handleTip("char-1", req());
    const res = await handleTip("char-1", req());
    expect(res.status).toBe(200);
    expect(
      state.ledger.filter((row) => row.idempotency_key.startsWith("tip:tipkey-0002")),
    ).toHaveLength(2);
    expect(state.balance.get(LOCAL_USER_ID)).toBe(200);
    expect(state.balance.get("author-1")).toBe(100);
  });

  it("残高不足は 409 で台帳も残らない", async () => {
    await grant(LOCAL_USER_ID, 50, "g1");
    const res = await handleTip("char-1", post({ amount: 100, idempotencyKey: "tipkey-0003" }));
    expect(res.status).toBe(409);
    expect(state.ledger.filter((row) => row.kind !== "grant")).toHaveLength(0);
  });

  it("自分の公開キャラへの贈与は拒否される", async () => {
    state.publish.set("char-mine", { user_id: LOCAL_USER_ID });
    await grant(LOCAL_USER_ID, 100, "g1");
    const res = await handleTip("char-mine", post({ amount: 10, idempotencyKey: "tipkey-0004" }));
    expect(res.status).toBe(422);
  });

  it("非公開キャラは 404・不正 body は 422", async () => {
    expect(
      (await handleTip("char-x", post({ amount: 10, idempotencyKey: "tipkey-0005" }))).status,
    ).toBe(404);
    expect((await handleTip("char-1", post({ amount: 0, idempotencyKey: "x" }))).status).toBe(422);
    expect((await handleTip("char-1", post({}))).status).toBe(422);
  });
});
