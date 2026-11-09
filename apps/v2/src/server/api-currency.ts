// 通貨 API（RIT-191）。GET /api/currency は残高と直近の台帳を返す。
// 増減の記録は server 側の currency.ts を各機能（購入・消費・返金・特典）から呼ぶ。
import { CurrencyError, readCurrencyStatus } from "./currency";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

// GET /api/currency — 残高と直近台帳（?limit= で最大200まで）。
export const handleCurrencyStatusRequest = async (request: Request): Promise<Response> => {
  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 50, 1), 200) : 50;
  try {
    const { env } = await getPlatform();
    const status = await readCurrencyStatus(env.DB, LOCAL_USER_ID, limit);
    return json(200, status as unknown as Record<string, unknown>);
  } catch (error) {
    if (error instanceof CurrencyError) {
      return json(error.status, { message: error.message });
    }
    throw error;
  }
};
