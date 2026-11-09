// RIT-193: プラン段階の確かめ — 有効化の課金・30日期限・期限切れ/解約で free へ
// 落ちる・同日同プラン再送の冪等・機能差（記憶深度・通貨ボーナスレート）を実 D1 で見る。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openLocalD1, type LocalD1 } from "../../../../packages/db/src/test/local-d1";

import { INITIAL_GRANT } from "./generation-billing";
import { activatePlan, cancelPlan, readPlan } from "./plan";
import { claimLoginBonus, recordAdReward } from "./retention";

const platform = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("./platform", () => ({ getPlatform: async () => platform }));

const { handlePlanActivateRequest, handlePlanCancelRequest, handlePlanStatusRequest } =
  await import("./api-plan");

let local: LocalD1;
const user = () => `u-${crypto.randomUUID()}`;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

beforeAll(async () => {
  local = await openLocalD1();
  platform.env = { DB: local.d1 };
}, 60_000);

afterAll(async () => {
  await local?.dispose();
});

describe("readPlan / activatePlan", () => {
  it("未契約は free、standard 有効化で500消費・30日間有効", async () => {
    const userId = user();
    const empty = await readPlan(local.d1, userId, T0);
    expect(empty.plan).toBe("free");
    expect(empty.active).toBe(false);
    const activated = await activatePlan(local.d1, userId, "standard", T0);
    expect(activated.plan).toBe("standard");
    expect(activated.charged).toBe(true);
    expect(activated.balance).toBe(INITIAL_GRANT - 500);
    expect(activated.expiresAt).toBe(T0 + 30 * DAY);
    expect(activated.features.memoryTopK).toBe(30);
    expect(activated.features.currencyBonusRate).toBe(1.1);
  });

  it("期限切れは free へ落ち、有効中の再有効化は課金しない", async () => {
    const userId = user();
    await activatePlan(local.d1, userId, "premium", T0);
    const during = await readPlan(local.d1, userId, T0 + 10 * DAY);
    expect(during.plan).toBe("premium");
    const again = await activatePlan(local.d1, userId, "premium", T0 + 10 * DAY);
    expect(again.charged).toBe(false);
    const expired = await readPlan(local.d1, userId, T0 + 31 * DAY);
    expect(expired.plan).toBe("free");
    expect(expired.active).toBe(false);
  });

  it("解約しても期限までは段階が残り、期限後は free", async () => {
    const userId = user();
    await activatePlan(local.d1, userId, "standard", T0);
    const cancelled = await cancelPlan(local.d1, userId, T0 + 5 * DAY);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.plan).toBe("standard");
    const after = await readPlan(local.d1, userId, T0 + 31 * DAY);
    expect(after.plan).toBe("free");
  });

  it("残高不足は 409 で契約も残らない", async () => {
    const userId = user();
    const { ensureSeedBalance } = await import("./generation-billing");
    await ensureSeedBalance(local.d1, userId);
    const { spendCurrency } = await import("./currency");
    await spendCurrency(local.d1, {
      userId,
      amount: INITIAL_GRANT - 100,
      reason: "テスト用消費",
      idempotencyKey: `drain-${crypto.randomUUID()}`,
    });
    await expect(activatePlan(local.d1, userId, "premium", T0)).rejects.toMatchObject({
      status: 409,
    });
    const status = await readPlan(local.d1, userId, T0);
    expect(status.plan).toBe("free");
  });
});

describe("機能差の適用", () => {
  it("premium は特典・報酬の付与量が1.25倍になる", async () => {
    const userId = user();
    const base = await claimLoginBonus(local.d1, userId, T0);
    expect(base.amount).toBe(10);
    const premium = await activatePlan(local.d1, userId, "premium", T0);
    expect(premium.features.currencyBonusRate).toBe(1.25);
    const next = await claimLoginBonus(local.d1, userId, T0 + DAY);
    // streak2 基礎15 × 1.25 = 18.75 → 19
    expect(next.amount).toBe(19);
    const ad = await recordAdReward(local.d1, { userId, attemptId: "ad-premium" });
    // 5 × 1.25 = 6.25 → 6
    expect(ad.amount).toBe(6);
  });
});

describe("handlers", () => {
  it("GET plan は free を返し、POST で有効化・cancel で解約できる", async () => {
    const status = await handlePlanStatusRequest();
    expect(status.status).toBe(200);
    const activated = await handlePlanActivateRequest(
      new Request("https://example.com/api/plan", {
        method: "POST",
        body: JSON.stringify({ plan: "standard" }),
      }),
    );
    expect(activated.status).toBe(200);
    const body: { plan: string; active: boolean } = await activated.json();
    expect(body.plan).toBe("standard");
    expect(body.active).toBe(true);
    const cancelled = await handlePlanCancelRequest();
    const cancelledBody: { cancelled: boolean } = await cancelled.json();
    expect(cancelledBody.cancelled).toBe(true);
  });

  it("POST plan は plan 必須で400を返す", async () => {
    const bad = await handlePlanActivateRequest(
      new Request("https://example.com/api/plan", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(bad.status).toBe(400);
  });
});
