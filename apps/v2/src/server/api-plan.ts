// プラン API（RIT-193）。GET=現在の段階・機能・期限、POST=有効化（通貨 spend）、
// POST /cancel=解約（期限まで段階は保持）。実決済は RIT-192 で後付け。
import { z } from "zod";

import { CurrencyError } from "./currency";
import { LOCAL_USER_ID } from "./identity";
import { activatePlan, cancelPlan, readPlan, type Plan } from "./plan";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const errorResponse = (error: unknown): Response => {
  if (error instanceof CurrencyError) {
    return json(error.status, { message: error.message });
  }
  throw error;
};

// GET /api/plan — 有効プランと機能差を返す（未契約・期限切れは free）。
export const handlePlanStatusRequest = async (): Promise<Response> => {
  try {
    const { env } = await getPlatform();
    const status = await readPlan(env.DB, LOCAL_USER_ID);
    return json(200, status as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
};

const activateSchema = z.object({
  plan: z.enum(["standard", "premium"]),
});

// POST /api/plan — プランを30日有効化（残高不足は409・同日同プラン再送は冪等）。
export const handlePlanActivateRequest = async (request: Request): Promise<Response> => {
  const parsed = activateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(400, { message: "plan に standard か premium を指定してください。" });
  }
  try {
    const { env } = await getPlatform();
    const result = await activatePlan(env.DB, LOCAL_USER_ID, parsed.data.plan as Plan);
    return json(200, result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
};

// POST /api/plan/cancel — 解約（期限切れで段階が落ちる）。
export const handlePlanCancelRequest = async (): Promise<Response> => {
  try {
    const { env } = await getPlatform();
    const status = await cancelPlan(env.DB, LOCAL_USER_ID);
    return json(200, status as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
};
