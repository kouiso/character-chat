import { OpenRouterKeyMissingError } from "@v2/engine";
import { z } from "zod";

import { CharacterInvalidError, CharacterNotFoundError, loadHistory, startTurn } from "./engine";
import { SSE_HEADERS, toSseStream } from "./sse";

import type { ChatSseEvent } from "../lib/sse-events";

const BodySchema = z.object({
  conversationId: z.string().nullish(),
  text: z.string().min(1).max(4000),
});

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ストリーム開始後の例外はヘッダが出た後なので HTTP ステータスに写せん。
// SSE の error イベントとして流して、クライアント側で表示させる。
const withErrorEvent = async function* (
  events: AsyncGenerator<ChatSseEvent>,
): AsyncGenerator<ChatSseEvent> {
  try {
    yield* events;
  } catch (error) {
    yield { type: "error", message: error instanceof Error ? error.message : "不明なエラー" };
  }
};

// startTurn / loadHistory が投げる型付き例外を HTTP ステータスへ写す。
const toErrorResponse = (error: unknown): Response => {
  if (error instanceof OpenRouterKeyMissingError) return json(503, { message: error.message });
  if (error instanceof CharacterNotFoundError) return json(404, { message: error.message });
  if (error instanceof CharacterInvalidError) {
    return json(422, { message: error.message, failures: error.failures });
  }
  return json(500, { message: error instanceof Error ? error.message : "不明なエラー" });
};

export const handleChatRequest = async (id: string, request: Request): Promise<Response> => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { message: "body が JSON やない" });
  }

  const parsed = BodySchema.safeParse(payload);
  if (!parsed.success) {
    return json(400, { message: "body が不正", issues: parsed.error.issues });
  }

  try {
    const { events } = await startTurn({
      characterId: id,
      conversationId: parsed.data.conversationId ?? null,
      text: parsed.data.text,
    });
    return new Response(toSseStream(withErrorEvent(events)), { status: 200, headers: SSE_HEADERS });
  } catch (error) {
    return toErrorResponse(error);
  }
};

// GET /api/chat/:id/history?conversationId=… — D1 に保存済みの履歴を返す（再起動後の確認口）。
export const handleHistoryRequest = async (id: string, request: Request): Promise<Response> => {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId) return json(400, { message: "conversationId クエリが無い" });
  try {
    return json(200, await loadHistory({ characterId: id, conversationId }));
  } catch (error) {
    return toErrorResponse(error);
  }
};
