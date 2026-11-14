// RIT-194: リテンション報酬の確かめ — ログイン特典の1日1回冪等・連続増量・
// ストリーク切れ、広告報酬の attemptId 冪等、1日券の課金→24h 解放・有効中の無課金を
// 実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { spendCurrency } from "./currency";
import { INITIAL_GRANT } from "./generation-billing";
import { activateDailyPass, claimLoginBonus, readDailyPass, recordAdReward } from "./retention";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handleAdRewardRequest, handleDailyPassActivateRequest, handleLoginBonusRequest } =
  await import("./api-retention");

let local: LocalD1;
const user = () => `u-${crypto.randomUUID()}`;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0); // 2026-11-09T12:00Z

const balanceOf = async (userId: string): Promise<number> => {
  const row = await local.d1
    .prepare("SELECT balance FROM v2_currency_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  return row ? row.balance : 0;
};

const ledgerCount = async (userId: string): Promise<number> => {
  const row = await local.d1
    .prepare("SELECT COUNT(*) AS n FROM v2_currency_ledger WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
};

beforeAll(async () => {
  local = await openLocalD1();
  platform.env = { DB: local.d1 };
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

describe("claimLoginBonus", () => {
  it("初日は streak1・10 付与、同日再送は二重付与しない", async () => {
    const userId = user();
    const first = await claimLoginBonus(local.d1, userId, T0);
    expect(first.claimed).toBe(true);
    expect(first.streak).toBe(1);
    expect(first.amount).toBe(10);
    expect(first.balance).toBe(10);
    const again = await claimLoginBonus(local.d1, userId, T0 + 3_600_000);
    expect(again.claimed).toBe(false);
    expect(again.streak).toBe(1);
    expect(await balanceOf(userId)).toBe(10);
    expect(await ledgerCount(userId)).toBe(1);
    const kind = await local.d1
      .prepare("SELECT kind FROM v2_currency_ledger WHERE user_id = ?")
      .bind(userId)
      .first<{ kind: string }>();
    expect(kind?.kind).toBe("bonus");
  });

  it("連続日で増量、切れると streak が戻る", async () => {
    const userId = user();
    await claimLoginBonus(local.d1, userId, T0);
    const day2 = await claimLoginBonus(local.d1, userId, T0 + DAY);
    expect(day2.streak).toBe(2);
    expect(day2.amount).toBe(15);
    // 1日空けるとリセット
    const day4 = await claimLoginBonus(local.d1, userId, T0 + 3 * DAY);
    expect(day4.streak).toBe(1);
    expect(day4.amount).toBe(10);
  });
});

describe("JST 日付の鍵（#183）", () => {
  const jst = (h: number, m: number, d = 10) => Date.UTC(2026, 10, d, h - 9, m, 0);

  it("JST 8:30 と 9:30 の受取は同じ日で 1 回だけ付与する", async () => {
    const userId = user();
    const first = await claimLoginBonus(local.d1, userId, jst(8, 30));
    const second = await claimLoginBonus(local.d1, userId, jst(9, 30));
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.day).toBe("2026-11-10");
    expect(second.streak).toBe(1);
    expect(await balanceOf(userId)).toBe(10);
  });

  it("JST 8:59 と 9:00 は同じ日、0 時をまたぐと別の日で連続日数が増える", async () => {
    const userId = user();
    await claimLoginBonus(local.d1, userId, jst(8, 59));
    expect((await claimLoginBonus(local.d1, userId, jst(9, 0))).claimed).toBe(false);
    const before = await claimLoginBonus(local.d1, userId, jst(23, 59));
    expect(before.claimed).toBe(false);
    const next = await claimLoginBonus(local.d1, userId, jst(0, 0, 11));
    expect(next.claimed).toBe(true);
    expect(next.day).toBe("2026-11-11");
    expect(next.streak).toBe(2);
  });

  it("切替前に UTC 日付で保存された受取があっても二重付与せず連続日数も保つ", async () => {
    const userId = user();
    const legacyAt = jst(8, 30);
    // 旧実装は JST 11/10 8:30 の受取を UTC 日付 11/09 で保存していた。
    await local.d1
      .prepare(
        "INSERT INTO v2_login_bonus (id, user_id, day, streak, amount, ledger_id, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(crypto.randomUUID(), userId, "2026-11-09", 3, 20, "legacy-ledger", legacyAt)
      .run();
    const sameDay = await claimLoginBonus(local.d1, userId, jst(9, 30));
    expect(sameDay.claimed).toBe(false);
    expect(sameDay.streak).toBe(3);
    expect(await ledgerCount(userId)).toBe(0);
    const nextDay = await claimLoginBonus(local.d1, userId, jst(10, 0, 11));
    expect(nextDay.claimed).toBe(true);
    expect(nextDay.streak).toBe(4);
  });

  it("1日券を JST 23:50 に買い 0:10 に再度有効化しても課金せず券は 1 枚のまま", async () => {
    const userId = user();
    const boughtAt = jst(23, 50);
    const bought = await activateDailyPass(local.d1, userId, boughtAt);
    expect(bought.charged).toBe(true);
    expect(bought.expiresAt).toBe(boughtAt + 24 * 3_600_000);
    const again = await activateDailyPass(local.d1, userId, jst(0, 10, 11));
    expect(again.charged).toBe(false);
    expect(again.expiresAt).toBe(bought.expiresAt);
    expect(await balanceOf(userId)).toBe(INITIAL_GRANT - 100);
    const passes = await local.d1
      .prepare("SELECT COUNT(*) AS n FROM v2_feature_pass WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>();
    expect(Number(passes?.n)).toBe(1);
    // JST 0 時では切れず、購入から 24 時間後に切れる。
    expect((await readDailyPass(local.d1, userId, boughtAt + 24 * 3_600_000 - 1)).active).toBe(
      true,
    );
    expect((await readDailyPass(local.d1, userId, boughtAt + 24 * 3_600_000)).active).toBe(false);
  });

  it("1日券の重複防止の鍵は JST の日付で作る", async () => {
    const userId = user();
    await activateDailyPass(local.d1, userId, jst(8, 30));
    const row = await local.d1
      .prepare(
        "SELECT ref_id FROM v2_currency_ledger WHERE user_id = ? AND ref_type = 'feature-pass'",
      )
      .bind(userId)
      .first<{ ref_id: string }>();
    expect(row?.ref_id).toBe("2026-11-10");
  });
});

describe("recordAdReward", () => {
  it("attemptId 単位で一回だけ bonus が入る", async () => {
    const userId = user();
    const first = await recordAdReward(local.d1, { userId, attemptId: "att-1" });
    expect(first.rewarded).toBe(true);
    expect(first.amount).toBe(5);
    const replay = await recordAdReward(local.d1, { userId, attemptId: "att-1" });
    expect(replay.rewarded).toBe(false);
    const other = await recordAdReward(local.d1, { userId, attemptId: "att-2" });
    expect(other.rewarded).toBe(true);
    expect(await balanceOf(userId)).toBe(10);
    const kinds = await local.d1
      .prepare("SELECT kind FROM v2_currency_ledger WHERE user_id = ? ORDER BY created_at, id")
      .bind(userId)
      .all<{ kind: string }>();
    expect(kinds.results.map((row) => row.kind)).toEqual(["bonus", "bonus"]);
  });
});

describe("activateDailyPass / readDailyPass", () => {
  it("購入でシード付与→100消費→24h 有効、有効中の再購入は課金しない", async () => {
    const userId = user();
    const bought = await activateDailyPass(local.d1, userId, T0);
    expect(bought.charged).toBe(true);
    expect(bought.active).toBe(true);
    expect(bought.expiresAt).toBe(T0 + 24 * 3_600_000);
    expect(bought.balance).toBe(INITIAL_GRANT - 100);
    const status = await readDailyPass(local.d1, userId, T0 + 3_600_000);
    expect(status.active).toBe(true);
    // 有効中の再購入は課金しない（既存券を返す）
    const rebuy = await activateDailyPass(local.d1, userId, T0 + 3_600_000);
    expect(rebuy.charged).toBe(false);
    expect(await balanceOf(userId)).toBe(INITIAL_GRANT - 100);
    // 切れた後は無効
    const expired = await readDailyPass(local.d1, userId, T0 + 25 * 3_600_000);
    expect(expired.active).toBe(false);
    expect(expired.expiresAt).toBeNull();
    // 切れて翌日の再購入は新規課金（購入冪等は日単位）。
    const after = await activateDailyPass(local.d1, userId, T0 + 25 * 3_600_000);
    expect(after.charged).toBe(true);
    expect(await balanceOf(userId)).toBe(INITIAL_GRANT - 200);
  });

  it("残高不足は 409 で券は発行されない", async () => {
    const userId = user();
    const { ensureSeedBalance } = await import("./generation-billing");
    await ensureSeedBalance(local.d1, userId);
    await spendCurrency(local.d1, {
      userId,
      amount: INITIAL_GRANT - 50,
      reason: "テスト用消費",
      idempotencyKey: `drain-${crypto.randomUUID()}`,
    });
    await expect(activateDailyPass(local.d1, userId, T0)).rejects.toMatchObject({
      status: 409,
    });
    const status = await readDailyPass(local.d1, userId, T0);
    expect(status.active).toBe(false);
  });
});

describe("handlers", () => {
  it("POST login-bonus は 200 で結果を返す", async () => {
    const response = await handleLoginBonusRequest();
    expect(response.status).toBe(200);
    const body: { claimed: boolean; streak: number } = await response.json();
    expect(typeof body.claimed).toBe("boolean");
    expect(body.streak).toBeGreaterThanOrEqual(1);
  });

  it("POST ad-reward は attemptId 必須", async () => {
    const bad = await handleAdRewardRequest(
      new Request("https://example.com/api/currency/ad-reward", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(bad.status).toBe(400);
    const ok = await handleAdRewardRequest(
      new Request("https://example.com/api/currency/ad-reward", {
        method: "POST",
        body: JSON.stringify({ attemptId: `h-${crypto.randomUUID()}` }),
      }),
    );
    expect(ok.status).toBe(200);
  });

  it("POST daily-pass は 200 で解放状態を返す", async () => {
    const response = await handleDailyPassActivateRequest();
    expect(response.status).toBe(200);
    const body: { active: boolean; expiresAt: number | null } = await response.json();
    expect(body.active).toBe(true);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });
});
