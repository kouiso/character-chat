import { ConversationAccessError, createDb } from "@v2/db";
import { ContextBudgetConfigError, contextBudgetFromEnv } from "@v2/engine";
import { z } from "zod";

import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";

import { recordProactiveActivity } from "./api-proactive";
import {
  CharacterInvalidError,
  CharacterNotFoundError,
  loadHistory,
  loadStoredTurn,
  LOCAL_USER_ID,
} from "./engine";
import { getPlatform } from "./platform";
import { SSE_HEADERS, toSseStream, type SequencedSseEvent } from "./sse";
import { checkDailyTurnLimit } from "./usage-limit";

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
  if (error instanceof ContextBudgetConfigError) {
    console.error(
      JSON.stringify({ event: "context_budget_config_invalid", message: error.message }),
    );
    return json(500, { message: "サーバー設定に誤りがあります。" });
  }
  return json(503, { message: "処理を開始できませんでした。再試行してください。" });
};

// 送信と、その送信が保存されたかの問い合わせは、同じ ChatRoom に届かんと答えが食い違う。
const chatRoomFor = (env: Cloudflare.Env, conversationId: string): DurableObjectStub<ChatRoom> =>
  env.CHAT_ROOMS.getByName(`${LOCAL_USER_ID}:${conversationId}`);

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
    if ((page.status === "succeeded" || page.status === "failed") && !page.hasMore) return;
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
    // 使いすぎ止め（RIT-103）。n 回目までは通し、n+1 回目は理由を添えて止める。
    const usage = await checkDailyTurnLimit(createDb(env.DB), env, Date.now());
    if (!usage.allowed) {
      return json(429, {
        code: "daily_limit",
        limit: usage.limit,
        message: `今日の会話回数の上限（${usage.limit}回）に達しました。送信文は入力欄に戻します。`,
      });
    }
    const room = chatRoomFor(env, parsed.data.conversationId);
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
    // 話しかけの空き時間は最後の発言から数える。返信を待たせんよう裏で記録する。
    void recordProactiveActivity(id).catch(() => {});
    return new Response(toSseStream(storedEvents(room, receipt.requestId, after)), {
      status: 200,
      headers: SSE_HEADERS,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};

const RequestIdParamSchema = z.string().min(1).max(120);

// 「入力に戻す」が、その送信が保存されたかを番号の進み具合で推測せんための口。
// 送信が割り当てられたターンを ChatRoom に聞き、そのターンの中身で判定する。
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
  const requestIdParam = params.get("requestId");
  const requestId = requestIdParam === null ? null : RequestIdParamSchema.safeParse(requestIdParam);
  if (requestId && !requestId.success)
    return json(400, { message: "requestIdを確認してください。" });
  try {
    if (!requestId) return json(200, await loadHistory({ characterId: id, conversationId }));
    const { env } = await getPlatform();
    const room = chatRoomFor(env, conversationId);
    const job = await room.jobTurn(requestId.data);
    // 作成中の送信は、キャラが読めん（404/422）時でも「戻してよい」と答えたらあかん。履歴より先に見る。
    if (job?.active) {
      return json(409, { code: "busy", message: "この会話の返信を作成中です。" });
    }
    const history = await loadHistory({ characterId: id, conversationId });
    return json(200, {
      ...history,
      storedTurn: job === null ? null : await readStoredTurn(id, conversationId, job.turn),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
};
