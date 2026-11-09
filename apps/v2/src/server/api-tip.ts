// クリエイターへの贈与 API（RIT-208）。公開中キャラの作者へ通貨を贈る。
// 台帳2行（送り手=spend/作者=tip）の原子移転は currency.ts の tipCurrency に任せる。
import { z } from "zod";

import { CurrencyError, tipCurrency } from "./currency";
import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const tipBodySchema = z.object({
  amount: z.number().int().positive().max(1_000_000),
  idempotencyKey: z.string().trim().min(8).max(120),
});

// POST /api/catalog/:id/tip {amount, idempotencyKey} — 作者へ贈与
export const handleTip = async (characterId: string, request: Request): Promise<Response> => {
  const parsed = tipBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success)
    return json(422, { message: "amount（正の整数）と idempotencyKey（8字以上）が必要です。" });
  const { env } = await getPlatform();
  const published = await env.DB.prepare(
    "SELECT user_id FROM v2_character_publish WHERE character_id = ?",
  )
    .bind(characterId)
    .first<{ user_id: string }>();
  if (!published) return json(404, { message: "公開キャラクターが見つかりません。" });
  try {
    const result = await tipCurrency(env.DB, {
      senderId: LOCAL_USER_ID,
      authorId: published.user_id,
      characterId,
      amount: parsed.data.amount,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return json(result.replayed ? 200 : 201, {
      senderBalance: result.senderBalance,
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof CurrencyError) return json(error.status, { message: error.message });
    throw error;
  }
};
