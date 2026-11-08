// PATCH /api/chat/:id/ledger — 会話の最新台帳を手で直す（RIT-118）。
// load が最新台帳を拾うので、直した値がそのまま次のターンの指示文に入る。
import {
  ConversationAccessError,
  createDb,
  sceneLedgerSchema,
  updateLatestLedger,
} from "@v2/db";
import { PROMPT_VERSION } from "@v2/prompt";
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { getPlatform } from "./platform";

const BodySchema = z.object({
  conversationId: z.string().min(1).max(120),
  ledger: sceneLedgerSchema,
});

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

export const handleLedgerRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { message: "JSONを解釈できませんでした。" });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json(422, { message: "台帳の形が正しくありません。", issues: parsed.error.issues });
  }
  try {
    const { env } = await getPlatform();
    const db = createDb(env.DB);
    const turn = await updateLatestLedger(
      db,
      { userId: LOCAL_USER_ID, characterId, promptVersion: PROMPT_VERSION },
      parsed.data.conversationId,
      parsed.data.ledger,
    );
    if (turn === null) {
      return json(409, { message: "まだ保存された台帳がありません。" });
    }
    return json(200, { turn, ledger: parsed.data.ledger });
  } catch (error) {
    if (error instanceof ConversationAccessError) {
      return json(404, { message: "会話が見つかりません。" });
    }
    throw error;
  }
};
