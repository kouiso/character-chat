// 記憶リセット API（RIT-196）。DELETE /api/chat/:id/memory で記憶3層を消す。
// :id はキャラ ID。?conversationId を付けるとその会話だけ、無ければキャラ全会話。
import { z } from "zod";

import { LOCAL_USER_ID } from "./identity";
import { resetConversationMemory } from "./memory-reset";
import { getPlatform } from "./platform";

const idSchema = z.string().min(1).max(120);

const findConversation = async (
  db: D1Database,
  characterId: string,
  conversationId: string | null,
): Promise<{ id: string } | null> => {
  const row = await (conversationId
    ? db
        .prepare("SELECT id FROM v2_conversation WHERE id = ? AND character_id = ? AND user_id = ?")
        .bind(conversationId, characterId, LOCAL_USER_ID)
        .first<{ id: string }>()
    : db
        .prepare("SELECT id FROM v2_conversation WHERE character_id = ? AND user_id = ? LIMIT 1")
        .bind(characterId, LOCAL_USER_ID)
        .first<{ id: string }>());
  return row ?? null;
};

const parseIds = (
  characterId: string,
  conversationParam: string | null,
): { characterId: string; conversationId: string | null } | Response => {
  const parsedId = idSchema.safeParse(characterId);
  if (!parsedId.success) {
    return Response.json({ message: "キャラクターIDが不正です。" }, { status: 400 });
  }
  const parsedConv = conversationParam ? idSchema.safeParse(conversationParam) : null;
  if (conversationParam && !parsedConv?.success) {
    return Response.json({ message: "会話IDが不正です。" }, { status: 400 });
  }
  return { characterId: parsedId.data, conversationId: parsedConv?.data ?? null };
};

// DELETE /api/chat/:id/memory — 記憶の全消去。対象が無ければ404。
export const handleMemoryResetRequest = async (
  characterId: string,
  request: Request,
): Promise<Response> => {
  const ids = parseIds(characterId, new URL(request.url).searchParams.get("conversationId"));
  if (ids instanceof Response) return ids;
  const { env } = await getPlatform();
  const base = await findConversation(env.DB, ids.characterId, ids.conversationId);
  if (!base) {
    return Response.json(
      {
        message: ids.conversationId
          ? "会話が見つかりません。"
          : "キャラクターの会話が見つかりません。",
      },
      { status: 404 },
    );
  }
  // キャラ指定時は基点の1会話から resolveConversations が同キャラ全会話へ展開する。
  const result = await resetConversationMemory(
    env.DB,
    env,
    base.id,
    ids.conversationId ? "conversation" : "character",
  );
  return Response.json(result);
};
