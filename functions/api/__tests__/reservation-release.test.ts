import { describe, expect, it } from "vitest";

import {
  atomicReserveRequest,
  enforceIdentitySourceGate,
  releaseReservedRequest,
  reservedPeriodsAt,
} from "../[[route]]";

type Recorded = { sql: string; binds: unknown[] };

// request_counter を素朴に再現する D1 スタブ。予約と解放の収支が合うかを見る。
const makeDb = (limits: { dailyLimit: number; monthlyLimitCents: number }) => {
  const counters = new Map<string, number>();
  const recorded: Recorded[] = [];

  const applyStatement = ({ sql, binds }: Recorded): { meta: { changes: number } } => {
    if (sql.startsWith("INSERT OR IGNORE")) {
      const [userId, period] = binds as [string, string];
      const type = sql.includes("daily_count") ? "daily_count" : "monthly_cost_cents";
      const key = `${userId}:${period}:${type}`;
      if (!counters.has(key)) counters.set(key, 0);
      return { meta: { changes: 1 } };
    }
    if (sql.includes("daily_count") && sql.includes("value + 1")) {
      const [userId, period] = binds as [string, string];
      const key = `${userId}:${period}:daily_count`;
      const current = counters.get(key) ?? 0;
      if (current >= limits.dailyLimit) return { meta: { changes: 0 } };
      counters.set(key, current + 1);
      return { meta: { changes: 1 } };
    }
    if (sql.includes("monthly_cost_cents") && sql.includes("value + ?")) {
      const [cost, userId, period] = binds as [number, string, string];
      const key = `${userId}:${period}:monthly_cost_cents`;
      const current = counters.get(key) ?? 0;
      if (current + cost > limits.monthlyLimitCents) return { meta: { changes: 0 } };
      counters.set(key, current + cost);
      return { meta: { changes: 1 } };
    }
    if (sql.includes("max(value - 1, 0)")) {
      const [userId, period] = binds as [string, string];
      const key = `${userId}:${period}:daily_count`;
      counters.set(key, Math.max((counters.get(key) ?? 0) - 1, 0));
      return { meta: { changes: 1 } };
    }
    if (sql.includes("max(value - ?, 0)")) {
      const [cost, userId, period] = binds as [number, string, string];
      const key = `${userId}:${period}:monthly_cost_cents`;
      counters.set(key, Math.max((counters.get(key) ?? 0) - cost, 0));
      return { meta: { changes: 1 } };
    }
    throw new Error(`unexpected sql: ${sql}`);
  };

  const DB = {
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => ({ sql, binds }),
    }),
    batch: (statements: Recorded[]) => {
      recorded.push(...statements);
      return Promise.resolve(statements.map(applyStatement));
    },
  } as unknown as D1Database;

  const read = (type: "daily_count" | "monthly_cost_cents", at: Date = new Date()): number => {
    const periods = reservedPeriodsAt(at);
    const period = type === "daily_count" ? periods.dailyPeriod : periods.monthlyPeriod;
    return counters.get(`user-1:${period}:${type}`) ?? 0;
  };

  const readAt = (
    userId: string,
    periods: { dailyPeriod: string; monthlyPeriod: string },
    type: "daily_count" | "monthly_cost_cents",
  ): number => {
    const period = type === "daily_count" ? periods.dailyPeriod : periods.monthlyPeriod;
    return counters.get(`${userId}:${period}:${type}`) ?? 0;
  };

  const seed = (
    userId: string,
    periods: { dailyPeriod: string; monthlyPeriod: string },
    values: { daily: number; monthly: number },
  ): void => {
    counters.set(`${userId}:${periods.dailyPeriod}:daily_count`, values.daily);
    counters.set(`${userId}:${periods.monthlyPeriod}:monthly_cost_cents`, values.monthly);
  };

  return { env: { DB }, read, readAt, seed, recorded };
};

describe("予約枠の解放", () => {
  const IMAGE_COST = 5;

  it("解放すると日次カウントと月次コストが予約前へ戻る", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    await atomicReserveRequest(db.env, "user-1", 10, 100, IMAGE_COST);
    expect(db.read("daily_count")).toBe(1);
    expect(db.read("monthly_cost_cents")).toBe(IMAGE_COST);

    await releaseReservedRequest(db.env, "user-1", IMAGE_COST, reservedPeriodsAt(new Date()));
    expect(db.read("daily_count")).toBe(0);
    expect(db.read("monthly_cost_cents")).toBe(0);
  });

  // 身元の出所が無いキャラは何度押しても直らん。解放せんとリトライのたびに枠が減り、
  // 画像タスクを1つも起こしとらんのに日次上限で締め出される。
  it("解放すれば同じ拒否を繰り返しても枠を食い潰さない", async () => {
    const db = makeDb({ dailyLimit: 3, monthlyLimitCents: 100 });
    for (let i = 0; i < 5; i += 1) {
      await atomicReserveRequest(db.env, "user-1", 3, 100, IMAGE_COST);
      await releaseReservedRequest(db.env, "user-1", IMAGE_COST, reservedPeriodsAt(new Date()));
    }
    expect(db.read("daily_count")).toBe(0);

    // 枠が残っとるので、正当なリクエストはまだ通る
    const reserved = await atomicReserveRequest(db.env, "user-1", 3, 100, IMAGE_COST);
    expect(reserved.reserved).toBe(true);
  });

  it("解放せずに拒否を繰り返すと日次上限で締め出される（解放前の挙動）", async () => {
    const db = makeDb({ dailyLimit: 3, monthlyLimitCents: 100 });
    for (let i = 0; i < 3; i += 1) {
      await atomicReserveRequest(db.env, "user-1", 3, 100, IMAGE_COST);
    }
    const reserved = await atomicReserveRequest(db.env, "user-1", 3, 100, IMAGE_COST);
    expect(reserved.reserved).toBe(false);
  });

  it("0 未満へは下げない", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    await releaseReservedRequest(db.env, "user-1", IMAGE_COST, reservedPeriodsAt(new Date()));
    expect(db.read("daily_count")).toBe(0);
    expect(db.read("monthly_cost_cents")).toBe(0);
  });
});

describe("身元ゲートと予約枠の結合", () => {
  const IMAGE_COST = 5;
  const reserve = async (db: ReturnType<typeof makeDb>): Promise<void> => {
    await atomicReserveRequest(db.env, "user-1", 10, 100, IMAGE_COST);
  };

  it("出所なしで弾く時は枠を返す", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    await reserve(db);
    const gate = await enforceIdentitySourceGate({
      env: db.env,
      userId: "user-1",
      costCents: IMAGE_COST,
      reservedPeriods: reservedPeriodsAt(new Date()),
      visualAnchors: "",
      hasAuthoritativeSource: false,
    });
    expect(gate.blocked).toBe(true);
    expect(db.read("daily_count")).toBe(0);
    expect(db.read("monthly_cost_cents")).toBe(0);
  });

  it("人格文からアンカーを抽出できても authoritative な出所がなければ弾く", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    await reserve(db);
    const gate = await enforceIdentitySourceGate({
      env: db.env,
      userId: "user-1",
      costCents: IMAGE_COST,
      reservedPeriods: reservedPeriodsAt(new Date()),
      visualAnchors: "brown hair, blue eyes",
      hasAuthoritativeSource: false,
    });
    expect(gate.blocked).toBe(true);
    expect(db.read("daily_count")).toBe(0);
    expect(db.read("monthly_cost_cents")).toBe(0);
  });

  it("アンカーがあれば通し、枠は減らしたまま（実際に生成するため）", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    await reserve(db);
    const gate = await enforceIdentitySourceGate({
      env: db.env,
      userId: "user-1",
      costCents: IMAGE_COST,
      reservedPeriods: reservedPeriodsAt(new Date()),
      visualAnchors: "brown hair, blue eyes",
      hasAuthoritativeSource: true,
    });
    expect(gate).toEqual({ blocked: false, degraded: false });
    expect(db.read("daily_count")).toBe(1);
  });

  it("抽出だけ失敗した時は劣化として通し、枠も返さない", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    await reserve(db);
    const gate = await enforceIdentitySourceGate({
      env: db.env,
      userId: "user-1",
      costCents: IMAGE_COST,
      reservedPeriods: reservedPeriodsAt(new Date()),
      visualAnchors: "",
      hasAuthoritativeSource: true,
    });
    expect(gate).toEqual({ blocked: false, degraded: true });
    expect(db.read("daily_count")).toBe(1);
  });

  // UTC の日/月境界をまたぐと、返却時刻から期間を計算し直した場合に
  // 「予約したのは前日、返すのは当日」になる。前日の枠は減ったまま、当日は別リクエストが
  // 積んだカウンタを削ってしまい、超過利用を許す。
  it("返却は予約した期間へ行い、境界の向こう側のカウンタを削らん", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    const reservedAt = new Date("2026-07-31T23:59:59.000Z");
    const afterBoundary = new Date("2026-08-01T00:00:01.000Z");
    const reservedPeriods = reservedPeriodsAt(reservedAt);
    const laterPeriods = reservedPeriodsAt(afterBoundary);
    expect(reservedPeriods.dailyPeriod).not.toBe(laterPeriods.dailyPeriod);

    // 予約は境界の手前、別リクエストは境界の向こう側にカウンタを持つ
    db.seed("user-1", reservedPeriods, { daily: 1, monthly: IMAGE_COST });
    db.seed("user-1", laterPeriods, { daily: 3, monthly: 30 });

    await releaseReservedRequest(db.env, "user-1", IMAGE_COST, reservedPeriods);

    expect(db.readAt("user-1", reservedPeriods, "daily_count")).toBe(0);
    expect(db.readAt("user-1", reservedPeriods, "monthly_cost_cents")).toBe(0);
    // 境界の向こう側（別リクエストが積んだ分）は触らん
    expect(db.readAt("user-1", laterPeriods, "daily_count")).toBe(3);
    expect(db.readAt("user-1", laterPeriods, "monthly_cost_cents")).toBe(30);
  });

  it("予約は使った期間を返す", async () => {
    const db = makeDb({ dailyLimit: 10, monthlyLimitCents: 100 });
    const before = reservedPeriodsAt(new Date());
    const reservation = await atomicReserveRequest(db.env, "user-1", 10, 100, IMAGE_COST);
    expect(reservation.reserved).toBe(true);
    expect(reservation.periods.dailyPeriod).toBe(before.dailyPeriod);
    expect(reservation.periods.monthlyPeriod).toBe(before.monthlyPeriod);
  });

  it("直らんキャラで押し続けても日次上限で締め出されない", async () => {
    const db = makeDb({ dailyLimit: 3, monthlyLimitCents: 100 });
    for (let i = 0; i < 5; i += 1) {
      await atomicReserveRequest(db.env, "user-1", 3, 100, IMAGE_COST);
      await enforceIdentitySourceGate({
        env: db.env,
        userId: "user-1",
        costCents: IMAGE_COST,
        reservedPeriods: reservedPeriodsAt(new Date()),
        visualAnchors: "",
        hasAuthoritativeSource: false,
      });
    }
    expect((await atomicReserveRequest(db.env, "user-1", 3, 100, IMAGE_COST)).reserved).toBe(true);
  });
});
