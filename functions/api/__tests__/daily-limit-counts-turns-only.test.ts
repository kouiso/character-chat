import { describe, expect, it } from "vitest";

import {
  COST_ESTIMATES,
  atomicReserveRequest,
  countsAgainstDailyLimit,
} from "../lib/route-context";

type Statement = { sql: string; args: unknown[] };

const fakeDb = (): { env: { DB: D1Database }; ran: Statement[] } => {
  const ran: Statement[] = [];
  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({ sql, args }),
  });
  const batch = async (statements: Statement[]) => {
    ran.push(...statements);
    return statements.map(() => ({ meta: { changes: 1 } }));
  };
  return {
    env: { DB: { prepare, batch } as unknown as D1Database },
    ran,
  };
};

const dailyStatements = (ran: Statement[]): Statement[] =>
  ran.filter((s) => s.sql.includes("daily_count"));

describe("日次の枠はターンだけを数える", () => {
  it("1ターンの裏で走る補助呼び出しは日次を消費せん", () => {
    expect(countsAgainstDailyLimit("memory-extract")).toBe(false);
    expect(countsAgainstDailyLimit("reply-suggestions")).toBe(false);
    expect(countsAgainstDailyLimit("suggestions")).toBe(false);
    expect(countsAgainstDailyLimit("generate-title")).toBe(false);
    expect(countsAgainstDailyLimit("judge")).toBe(false);
  });

  it("ターンを進める呼び出しは日次を消費する", () => {
    expect(countsAgainstDailyLimit("chat")).toBe(true);
    expect(countsAgainstDailyLimit("image")).toBe(true);
    expect(countsAgainstDailyLimit("generate-character")).toBe(true);
    // 背景測定は専用の擬似ユーザーの日次枠が絞りそのものなので残す。
    expect(countsAgainstDailyLimit("chat-shadow")).toBe(true);
  });

  it("補助として予約した時は daily_count へ一切触らん", async () => {
    const { env, ran } = fakeDb();
    const result = await atomicReserveRequest(env, "u1", 500, 10_000, 1, false);
    expect(result.reserved).toBe(true);
    expect(dailyStatements(ran)).toHaveLength(0);
  });

  it("ターンとして予約した時は daily_count を積む", async () => {
    const { env, ran } = fakeDb();
    const result = await atomicReserveRequest(env, "u1", 500, 10_000, COST_ESTIMATES.chat ?? 10);
    expect(result.reserved).toBe(true);
    expect(dailyStatements(ran).length).toBeGreaterThan(0);
  });
});
