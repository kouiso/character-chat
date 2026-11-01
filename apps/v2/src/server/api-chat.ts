import { ConversationAccessError } from "@v2/db";
import { z } from "zod";

import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";

import {
  CharacterInvalidError,
  CharacterNotFoundError,
  loadHistory,
  loadStoredTurn,
  LOCAL_USER_ID,
} from "./engine";
import { getPlatform } from "./platform";
import { SSE_HEADERS, toSseStream, type SequencedSseEvent } from "./sse";

import type { ChatRoom } from "./chat-room";

const BodySchema = z.object({
  conversationId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(120),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  retry: z.boolean().optional(),
});

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const toErrorResponse = (error: unknown): Response => {
  if (error instanceof CharacterNotFoundError || error instanceof ConversationAccessError) {
    return json(404, { message: "会話またはキャラクターが見つかりません。" });
  }
  if (error instanceof CharacterInvalidError) {
    return json(422, { message: "キャラクターの設定を確認してください。" });
  }
  return json(503, { message: "処理を開始できませんでした。再試行してください。" });
};

const storedEvents = async function* (
  room: DurableObjectStub<ChatRoom>,
  requestId: string,
  after: number,
): AsyncGenerator<SequencedSseEvent> {
  let cursor = after;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const page = await room.readEvents(requestId, cursor);
    for (const item of page.events) {
      cursor = item.id;
      yield item;
    }
    if ((page.status === "succeeded" || page.status === "failed") && page.events.length < 100)
      return;
    if (page.status === "missing") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  yield {
    id: cursor,
    event: { type: "error", message: "処理状況を再確認してください。返信処理は継続しています。" },
  };
};

export const handleChatRequest = async (id: string, request: Request): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { message: "JSON形式で送信してください。" });
  }
  const parsed = BodySchema.safeParse(payload);
  const after = Number(request.headers.get("last-event-id") ?? "0");
  if (!parsed.success || !Number.isSafeInteger(after) || after < 0) {
    return json(400, { message: "送信内容を確認してください。" });
  }
  try {
    await loadHistory({ characterId: id, conversationId: parsed.data.conversationId });
    const { env } = await getPlatform();
    const room = env.CHAT_ROOMS.getByName(`${LOCAL_USER_ID}:${parsed.data.conversationId}`);
    const receipt = await room.submit({ ...parsed.data, characterId: id });
    if (receipt.status !== "accepted") {
      return json(409, {
        code: receipt.status,
        message:
          receipt.status === "busy"
            ? "この会話の返信を作成中です。"
            : "同じ受付番号に異なる送信内容は指定できません。",
      });
    }
    return new Response(toSseStream(storedEvents(room, receipt.requestId, after)), {
      status: 200,
      headers: SSE_HEADERS,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};

const TurnParamSchema = z.coerce.number().int().positive();

// 「入力に戻す」が、そのターンに自分の発言と返信が保存されたかを番号の進み具合で推測せんための口。
// 別の送信が会話を進めても、そのターンの中身で判定できる。
const readStoredTurn = async (characterId: string, conversationId: string, turn: number) => {
  const messages = await loadStoredTurn(characterId, conversationId, turn);
  return {
    turn,
    user: messages.find((message) => message.role === "user")?.content ?? null,
    answered: messages.some(
      (message) => message.role === "assistant" && message.content.trim() !== "",
    ),
  };
};

export const handleHistoryRequest = async (id: string, request: Request): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const conversationId = params.get("conversationId");
  if (!conversationId) return json(400, { message: "conversationIdを指定してください。" });
  const turnParam = params.get("turn");
  const turn = turnParam === null ? null : TurnParamSchema.safeParse(turnParam);
  if (turn && !turn.success) return json(400, { message: "turnを確認してください。" });
  try {
    const history = await loadHistory({ characterId: id, conversationId });
    if (!turn) return json(200, history);
    return json(200, {
      ...history,
      storedTurn: await readStoredTurn(id, conversationId, turn.data),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
