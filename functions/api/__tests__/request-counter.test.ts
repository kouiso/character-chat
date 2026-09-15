import { describe, expect, it } from "vitest";

import { atomicReserveRequest } from "../[[route]]";

type CounterType = "daily_count" | "monthly_cost_cents";

type CounterSeed = {
  counterType: CounterType;
  period: string;
  userId: string;
  value: number;
};

type AtomicStatement = {
  binds: readonly unknown[];
  run: () => Promise<D1Result>;
  sql: string;
};

const currentPeriods = (): { dailyPeriod: string; monthlyPeriod: string } => {
  const now = new Date();
  return {
    dailyPeriod: now.toISOString().slice(0, 10),
    monthlyPeriod: now.toISOString().slice(0, 7),
  };
};

const counterKey = (userId: string, period: string, counterType: CounterType): string =>
  `${userId}\0${period}\0${counterType}`;

const toStringBind = (value: unknown): string => {
  if (typeof value !== "string") throw new TypeError("expected string bind");
  return value;
};

const toNumberBind = (value: unknown): number => {
  if (typeof value !== "number") throw new TypeError("expected number bind");
  return value;
};

const resultWithChanges = (changes: number): D1Result =>
  ({ success: true, meta: { changes } }) as D1Result;

const resolveCounterType = (sqlText: string): CounterType =>
  sqlText.includes("'daily_count'") ? "daily_count" : "monthly_cost_cents";

const createAtomicCounterD1Mock = (seeds: CounterSeed[] = []) => {
  const counters = new Map<string, number>(
    seeds.map((seed) => [counterKey(seed.userId, seed.period, seed.counterType), seed.value]),
  );

  const insertMissingCounter = (statement: AtomicStatement): D1Result => {
    const userId = toStringBind(statement.binds[0]);
    const period = toStringBind(statement.binds[1]);
    const key = counterKey(userId, period, resolveCounterType(statement.sql));
    if (counters.has(key)) return resultWithChanges(0);
    counters.set(key, 0);
    return resultWithChanges(1);
  };

  const incrementDailyCounter = (statement: AtomicStatement): D1Result => {
    const userId = toStringBind(statement.binds[0]);
    const period = toStringBind(statement.binds[1]);
    const limit = toNumberBind(statement.binds[2]);
    const key = counterKey(userId, period, "daily_count");
    const current = counters.get(key) ?? 0;
    if (current >= limit) return resultWithChanges(0);
    counters.set(key, current + 1);
    return resultWithChanges(1);
  };

  const incrementMonthlyCounter = (statement: AtomicStatement): D1Result => {
    const costCents = toNumberBind(statement.binds[0]);
    const userId = toStringBind(statement.binds[1]);
    const period = toStringBind(statement.binds[2]);
    const checkedCostCents = toNumberBind(statement.binds[3]);
    const limit = toNumberBind(statement.binds[4]);
    const key = counterKey(userId, period, "monthly_cost_cents");
    const current = counters.get(key) ?? 0;
    if (current + checkedCostCents > limit) return resultWithChanges(0);
    counters.set(key, current + costCents);
    return resultWithChanges(1);
  };

  const compensateDailyCounter = (statement: AtomicStatement): D1Result => {
    const userId = toStringBind(statement.binds[0]);
    const period = toStringBind(statement.binds[1]);
    const key = counterKey(userId, period, "daily_count");
    counters.set(key, Math.max((counters.get(key) ?? 0) - 1, 0));
    return resultWithChanges(1);
  };

  const compensateMonthlyCounter = (statement: AtomicStatement): D1Result => {
    const costCents = toNumberBind(statement.binds[0]);
    const userId = toStringBind(statement.binds[1]);
    const period = toStringBind(statement.binds[2]);
    const key = counterKey(userId, period, "monthly_cost_cents");
    counters.set(key, Math.max((counters.get(key) ?? 0) - costCents, 0));
    return resultWithChanges(1);
  };

  const executeStatement = (statement: AtomicStatement): D1Result => {
    if (statement.sql.startsWith("INSERT OR IGNORE")) return insertMissingCounter(statement);
    if (statement.sql.includes("max(value - 1")) return compensateDailyCounter(statement);
    if (statement.sql.includes("max(value - ?")) return compensateMonthlyCounter(statement);
    if (statement.sql.includes("counter_type = 'daily_count'")) {
      return incrementDailyCounter(statement);
    }
    return incrementMonthlyCounter(statement);
  };

  const db = {
    batch: (statements: D1PreparedStatement[]) =>
      Promise.resolve(
        statements.map((statement) => executeStatement(statement as unknown as AtomicStatement)),
      ),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    exec: () => Promise.resolve({ count: 0, duration: 0 } as D1ExecResult),
    prepare: (sqlText: string) => ({
      bind: (...binds: unknown[]) =>
        ({
          binds,
          run: () =>
            Promise.resolve(
              executeStatement({ binds, run: async () => resultWithChanges(0), sql: sqlText }),
            ),
          sql: sqlText,
        }) as unknown as D1PreparedStatement,
    }),
  } as unknown as D1Database;

  const getValue = (userId: string, period: string, counterType: CounterType): number =>
    counters.get(counterKey(userId, period, counterType)) ?? 0;

  return { db, getValue };
};

const createEnv = (db: D1Database): Parameters<typeof atomicReserveRequest>[0] =>
  ({
    AUTH_TOKEN: "test-token",
    BUCKET: {} as R2Bucket,
    DB: db,
    NOVITA_API_KEY: "",
    OPENROUTER_API_KEY: "",
  }) as Parameters<typeof atomicReserveRequest>[0];

const reserveSequentially = async <T>(count: number, reserve: () => Promise<T>): Promise<T[]> => {
  const results: T[] = [];
  await Array.from({ length: count }).reduce<Promise<void>>(
    (previous) =>
      previous.then(async () => {
        results.push(await reserve());
      }),
    Promise.resolve(),
  );
  return results;
};

const reserveConcurrently = <T>(count: number, reserve: () => Promise<T>): Promise<T[]> =>
  Promise.all(Array.from({ length: count }, () => reserve()));

describe("atomicReserveRequest", () => {
  it("allows only one concurrent request when the daily counter has one slot left", async () => {
    const userId = "user-1";
    const { dailyPeriod, monthlyPeriod } = currentPeriods();
    const counter = createAtomicCounterD1Mock([
      { counterType: "daily_count", period: dailyPeriod, userId, value: 9 },
    ]);
    const env = createEnv(counter.db);

    const results = await Promise.all([
      atomicReserveRequest(env, userId, 10, 1_000, 10),
      atomicReserveRequest(env, userId, 10, 1_000, 10),
    ]);

    expect(results.filter((r) => r.reserved)).toHaveLength(1);
    expect(counter.getValue(userId, dailyPeriod, "daily_count")).toBe(10);
    expect(counter.getValue(userId, monthlyPeriod, "monthly_cost_cents")).toBe(10);
  });

  it("allows sequential requests under the daily limit and rejects the next request", async () => {
    const userId = "user-2";
    const { dailyPeriod } = currentPeriods();
    const counter = createAtomicCounterD1Mock();
    const env = createEnv(counter.db);

    const results = await reserveSequentially(10, () =>
      atomicReserveRequest(env, userId, 10, 1_000, 10),
    );
    const nextResult = await atomicReserveRequest(env, userId, 10, 1_000, 10);

    expect(results.map((r) => r.reserved)).toEqual(Array.from({ length: 10 }, () => true));
    expect(nextResult.reserved).toBe(false);
    expect(counter.getValue(userId, dailyPeriod, "daily_count")).toBe(10);
  });

  it("caps concurrent daily reservations at the daily limit", async () => {
    const userId = "user-daily-concurrency";
    const { dailyPeriod } = currentPeriods();
    const counter = createAtomicCounterD1Mock();
    const env = createEnv(counter.db);

    const results = await reserveConcurrently(20, () =>
      atomicReserveRequest(env, userId, 5, 1_000, 1),
    );

    expect(results.filter((r) => r.reserved)).toHaveLength(5);
    expect(results.filter((result) => !result.reserved)).toHaveLength(15);
    expect(counter.getValue(userId, dailyPeriod, "daily_count")).toBe(5);
  });

  it("caps concurrent monthly cost reservations at the monthly cost limit", async () => {
    const userId = "user-monthly-concurrency";
    const { monthlyPeriod } = currentPeriods();
    const counter = createAtomicCounterD1Mock();
    const env = createEnv(counter.db);

    const results = await reserveConcurrently(10, () =>
      atomicReserveRequest(env, userId, 100, 100, 25),
    );
    const successCount = results.filter((r) => r.reserved).length;
    const monthlyCost = counter.getValue(userId, monthlyPeriod, "monthly_cost_cents");

    expect(successCount).toBeLessThanOrEqual(4);
    expect(successCount * 25).toBeLessThanOrEqual(100);
    expect(monthlyCost).toBeLessThanOrEqual(100);
    expect(monthlyCost).toBe(successCount * 25);
  });

  it("rejects a reservation that would exceed the monthly cost limit", async () => {
    const userId = "user-3";
    const { dailyPeriod, monthlyPeriod } = currentPeriods();
    const counter = createAtomicCounterD1Mock([
      { counterType: "monthly_cost_cents", period: monthlyPeriod, userId, value: 95 },
    ]);
    const env = createEnv(counter.db);

    const result = await atomicReserveRequest(env, userId, 10, 100, 10);

    expect(result.reserved).toBe(false);
    expect(counter.getValue(userId, dailyPeriod, "daily_count")).toBe(0);
    expect(counter.getValue(userId, monthlyPeriod, "monthly_cost_cents")).toBe(95);
  });

  it("compensates the daily reservation when monthly cost is already at the limit", async () => {
    const userId = "user-compensation";
    const { dailyPeriod, monthlyPeriod } = currentPeriods();
    const counter = createAtomicCounterD1Mock([
      { counterType: "daily_count", period: dailyPeriod, userId, value: 2 },
      { counterType: "monthly_cost_cents", period: monthlyPeriod, userId, value: 100 },
    ]);
    const env = createEnv(counter.db);

    const result = await atomicReserveRequest(env, userId, 5, 100, 25);

    expect(result.reserved).toBe(false);
    expect(counter.getValue(userId, dailyPeriod, "daily_count")).toBe(2);
    expect(counter.getValue(userId, monthlyPeriod, "monthly_cost_cents")).toBe(100);
  });
});
