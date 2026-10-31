import { ConversationAccessError } from "@v2/db";
import { ContextBudgetConfigError, contextBudgetFromEnv } from "@v2/engine";
import { z } from "zod";

import {
  CharacterInvalidError,
  CharacterNotFoundError,
  loadHistory,
  LOCAL_USER_ID,
} from "./engine";
import { getPlatform } from "./platform";
import { SSE_HEADERS, toSseStream, type SequencedSseEvent } from "./sse";

import type { ChatRoom } from "./chat-room";

const BodySchema = z.object({
  conversationId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(120),
  text: z.string().min(1).max(4000),
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
  if (error instanceof ContextBudgetConfigError) {
    console.error(
      JSON.stringify({ event: "context_budget_config_invalid", message: error.message }),
    );
    return json(500, { message: "サーバー設定に誤りがあります。" });
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
    // 設定ミスを ChatRoom の3回リトライまで持ち込まず、受付前に1回で落とす。
    contextBudgetFromEnv(env);
    const room = env.CHAT_ROOMS.getByName(`${LOCAL_USER_ID}:${parsed.data.conversationId}`);
    const receipt = await room.submit({ ...parsed.data, characterId: id });
    if (receipt.status !== "accepted") {
      return json(409, {
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

export const handleHistoryRequest = async (id: string, request: Request): Promise<Response> => {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId) return json(400, { message: "conversationIdを指定してください。" });
  try {
    return json(200, await loadHistory({ characterId: id, conversationId }));
  } catch (error) {
    return toErrorResponse(error);
  }
};
