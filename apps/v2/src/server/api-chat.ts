import { ConversationAccessError, createDb, describeError, truncateAssistantReply } from "@v2/db";
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
import { reportFailure } from "./log";
import { deleteMemoryVectors } from "./memory-reset";
import { getPlatform } from "./platform";
import { SSE_HEADERS, toSseStream, type SequencedSseEvent } from "./sse";
import { checkDailyTurnLimit } from "./usage-limit";

import type { ChatRoom, JobPeek, TurnReceipt } from "./chat-room";

const BodySchema = z.object({
  conversationId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(120),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  retry: z.boolean().optional(),
});

const WithdrawSchema = z.object({
  conversationId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(120),
});

const StopSchema = z.object({
  conversationId: z.string().min(1).max(120),
  requestId: z.string().min(1).max(120),
  shownSeq: z.number().int().min(0).nullable(),
});

const json = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const toErrorResponse = (error: unknown, env: unknown, route: string): Response => {
  if (error instanceof CharacterNotFoundError || error instanceof ConversationAccessError) {
    return json(404, { message: "会話またはキャラクターが見つかりません。" });
  }
  if (error instanceof CharacterInvalidError) {
    return json(422, { message: "キャラクターの設定を確認してください。" });
  }
  if (error instanceof ContextBudgetConfigError) {
    reportFailure(env, {
      event: "context_budget_config_invalid",
      level: "error",
      status: 500,
      route,
      reason: describeError(error),
    });
    return json(500, { message: "サーバー設定に誤りがあります。" });
  }
  return json(503, { message: "処理を開始できませんでした。再試行してください。" });
};

// 送信と、その送信が保存されたかの問い合わせは、同じ ChatRoom に届かんと答えが食い違う。
const chatRoomFor = (env: Cloudflare.Env, conversationId: string): DurableObjectStub<ChatRoom> =>
  env.CHAT_ROOMS.getByName(`${LOCAL_USER_ID}:${conversationId}`);

// 受付の出来事が終わりまで行ったかどうかの印。これ以上来ん受付は接続を閉じる。
const FINISHED_JOB_STATUS = new Set(["succeeded", "failed", "stopped", "missing"]);
const TERMINAL_EVENT_TYPE = new Set(["done", "error", "stopped"]);

// 1 ページ分の出来事を配る。終わりの印を見たら sink.terminal を立てる。
const emitPage = function* (
  page: { events: SequencedSseEvent[] },
  sink: { cursor: number; terminal: boolean },
): Generator<SequencedSseEvent> {
  for (const item of page.events) {
    sink.cursor = item.id;
    // 保存からの経過を画面が出せるよう、配る瞬間のサーバ時刻を done に添える（端末の時計は使わん）。
    yield item.event.type === "done"
      ? { ...item, event: { ...item.event, serverNow: Date.now() } }
      : item;
    if (TERMINAL_EVENT_TYPE.has(item.event.type)) sink.terminal = true;
  }
};

// SSE の行。出来事が来るたびに出し、無い間はつなぎの行（: ping）を送る。
// 終わりの出来事（done・stopped・error）を配ったら閉じる。部屋が 250ms 毎ではなく
// 出来事の到着で起きる（waitEvents）ので、途切れた接続は速く返る。
const storedEvents = async function* (
  room: DurableObjectStub<ChatRoom>,
  requestId: string,
  after: number,
): AsyncGenerator<SequencedSseEvent | { comment: string }> {
  let cursor = after;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    // 部屋の待ちが落ちた時は、少し待って読み直す。切れたまま返すと再接続の嵐になる。
    const page = await room.waitEvents(requestId, cursor, 15_000).catch(() => null);
    if (page === null) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    if (page.events.length === 0 && !page.hasMore) {
      if (FINISHED_JOB_STATUS.has(page.status)) return;
      yield { comment: "ping" };
      continue;
    }
    const sink = { cursor, terminal: false };
    yield* emitPage(page, sink);
    cursor = sink.cursor;
    if (sink.terminal && !page.hasMore) return;
  }
  // 3 分を超えたら黙って閉じる。画面は途切れを見て自分でつなぎ直す。
};

const peekOrNull = async (
  room: DurableObjectStub<ChatRoom>,
  requestId: string,
): Promise<JobPeek | null> => room.peek(requestId);

// 受け付けられんかった受付の返事。busy の時は走っとる受付の名札を添える（画面が区別に使う）。
const rejectedReceiptResponse = async (
  room: DurableObjectStub<ChatRoom>,
  receipt: TurnReceipt,
): Promise<Response> => {
  const active = receipt.status === "busy" ? await room.current() : null;
  return json(409, {
    code: receipt.status,
    message:
      receipt.status === "busy"
        ? "この会話の返信を作成中です。"
        : "同じ受付番号に異なる送信内容は指定できません。",
    ...(active
      ? {
          active: {
            requestId: active.requestId,
            kind: active.kind,
            text: active.text,
            turn: active.turn,
          },
        }
      : {}),
  });
};

// 使いすぎ止め（RIT-103）。部屋にすでに在る受付番号（再接続・二重送信）では回数を重ねて
// 数えんので、新しい受付の時だけ調べる。通す時は null。
const dailyLimitResponse = async (
  env: Cloudflare.Env,
  existing: JobPeek | null,
): Promise<Response | null> => {
  if (existing) return null;
  const usage = await checkDailyTurnLimit(createDb(env.DB), env, Date.now());
  if (usage.allowed) return null;
  return json(429, {
    code: "daily_limit",
    limit: usage.limit,
    message: `今日の会話回数の上限（${usage.limit}回）に達しました。送信文は入力欄に戻します。`,
  });
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
  // getPlatform が落ちた時も設定エラーの記録と知らせは出したいので、env は失敗しうる値として持つ。
  let env: Cloudflare.Env | undefined;
  try {
    await loadHistory({ characterId: id, conversationId: parsed.data.conversationId });
    ({ env } = await getPlatform());
    // 設定ミスを ChatRoom の3回リトライまで持ち込まず、受付前に1回で落とす。
    contextBudgetFromEnv(env);
    const room = chatRoomFor(env, parsed.data.conversationId);
    const limited = await dailyLimitResponse(env, await peekOrNull(room, parsed.data.requestId));
    if (limited) return limited;
    const receipt = await room.submit({ ...parsed.data, characterId: id });
    if (receipt.status !== "accepted") {
      return rejectedReceiptResponse(room, receipt);
    }
    // 話しかけの空き時間は最後の発言から数える。新しい受付の時だけ裏で記録する。
    if (receipt.created) void recordProactiveActivity(id).catch(() => {});
    return new Response(toSseStream(storedEvents(room, receipt.requestId, after)), {
      status: 200,
      headers: SSE_HEADERS,
    });
  } catch (error) {
    return toErrorResponse(error, env, "/api/chat/:id");
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
  // 読み取りの要求で状態を変えんよう、取り下げの口は POST /withdraw に限る。
  // 中継や先読みが requestId つきで GET しても、意図しない取り下げが起きん。
  if (params.get("requestId") !== null) {
    return json(400, {
      code: "use_withdraw",
      message: "requestId は withdraw へ送ってください。",
    });
  }
  try {
    return json(200, await loadHistory({ characterId: id, conversationId }));
  } catch (error) {
    return toErrorResponse(error, undefined, "/api/chat/:id/history");
  }
};

// POST /api/chat/:id/withdraw — 「入力に戻す」。作業中は 409。
export const handleWithdrawRequest = async (id: string, request: Request): Promise<Response> => {
  const parsed = WithdrawSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { message: "送信内容を確認してください。" });
  // getPlatform が落ちた時も設定エラーの記録と知らせは出したいので、env は失敗しうる値として持つ。
  let env: Cloudflare.Env | undefined;
  try {
    ({ env } = await getPlatform());
    const room = chatRoomFor(env, parsed.data.conversationId);
    const job = await room.withdraw(parsed.data.requestId);
    // 作成中の送信は、キャラが読めん（404/422）時でも「戻してよい」と答えたらあかん。履歴より先に見る。
    if (job?.active) {
      return json(409, { code: "busy", message: "この会話の返信を作成中です。" });
    }
    const history = await loadHistory({
      characterId: id,
      conversationId: parsed.data.conversationId,
    });
    return json(200, {
      ...history,
      storedTurn:
        job === null ? null : await readStoredTurn(id, parsed.data.conversationId, job.turn),
    });
  } catch (error) {
    return toErrorResponse(error, env, "/api/chat/:id/withdraw");
  }
};

// GET /api/chat/:id/turn?conversationId=…[&requestId=…] — 進行中の受付の調べ。
// 自分の受付が部屋に残っとるか、別の受付が走っとるかを画面が見る口。
export const handleTurnRequest = async (id: string, request: Request): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const conversationId = params.get("conversationId");
  if (!conversationId) return json(400, { message: "conversationIdを指定してください。" });
  const requestIdParam = params.get("requestId");
  const requestId = requestIdParam === null ? null : RequestIdParamSchema.safeParse(requestIdParam);
  if (requestId && !requestId.success)
    return json(400, { message: "requestIdを確認してください。" });
  let env: Cloudflare.Env | undefined;
  try {
    // 所有境界: URL のキャラと会話の character_id が違えば 404、部屋は呼ばん。
    await loadHistory({ characterId: id, conversationId });
    ({ env } = await getPlatform());
    const room = chatRoomFor(env, conversationId);
    const active = await room.current();
    const request = requestId ? await room.peek(requestId.data) : null;
    return json(200, { active, request });
  } catch (error) {
    return toErrorResponse(error, env, "/api/chat/:id/turn");
  }
};

// GET /api/chat/:id/events?conversationId=…&requestId=… — 受付の出来事をもう一度配る口。
// POST の SSE と同じ並びを、続きの番号（Last-Event-ID）から出す。
export const handleEventsRequest = async (id: string, request: Request): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const conversationId = params.get("conversationId");
  if (!conversationId) return json(400, { message: "conversationIdを指定してください。" });
  const requestId = RequestIdParamSchema.safeParse(params.get("requestId"));
  if (!requestId.success) return json(400, { message: "requestIdを確認してください。" });
  const after = Number(request.headers.get("last-event-id") ?? params.get("after") ?? "0");
  if (!Number.isSafeInteger(after) || after < 0) {
    return json(400, { message: "送信内容を確認してください。" });
  }
  let env: Cloudflare.Env | undefined;
  try {
    await loadHistory({ characterId: id, conversationId });
    ({ env } = await getPlatform());
    const room = chatRoomFor(env, conversationId);
    if ((await room.peek(requestId.data)) === null) {
      return json(404, { code: "missing", message: "この送信は見つかりません。" });
    }
    return new Response(toSseStream(storedEvents(room, requestId.data, after)), {
      status: 200,
      headers: SSE_HEADERS,
    });
  } catch (error) {
    return toErrorResponse(error, env, "/api/chat/:id/events");
  }
};

// 「止めた時すでに保存済み」の後片付け。画面に出てない塊を切り落とし、
// 記憶の配送も pending へ戻して部屋を起こす。戻り値は画面へ返す outcome。
const resolveSavedStop = async (
  env: Cloudflare.Env,
  room: DurableObjectStub<ChatRoom>,
  id: string,
  conversationId: string,
  requestId: string,
  turn: number | null,
  shownSeq: number | null,
  kind: string,
): Promise<Response> => {
  // 再生成の受付は触らん（別の返事のはずなので saved として扱う）。
  if (kind !== "send") return json(200, { outcome: "saved", turn });
  const truncated = await truncateAssistantReply(
    createDb(env.DB),
    { userId: LOCAL_USER_ID, characterId: id, promptVersion: "v0002" },
    { conversationId, turn: turn ?? 0, keepThroughSeq: shownSeq },
  ).catch((error) => {
    reportFailure(env, {
      event: "chat_stop_truncate_failed",
      level: "error",
      jobId: requestId,
      conversationId,
      reason: describeError(error),
    });
    return null;
  });
  if (truncated === null) {
    return json(503, {
      message: "止めた返事の後処理に失敗しました。履歴を再読み込みしてください。",
    });
  }
  if (!truncated.truncated) return json(200, { outcome: "saved", turn });
  try {
    await deleteMemoryVectors(env, truncated.removedMemories);
  } catch {
    // ベクトルの消去に失敗しても、行の切り詰めは済んでいる。記憶の配送は pending に
    // 戻したので、拾い残しは次の alarm で掃かれる。
  }
  await room.wake();
  return json(200, { outcome: "truncated", turn });
};

// POST /api/chat/:id/stop — 「止める」。画面に出た塊だけ残して返事を畳む。
export const handleStopRequest = async (id: string, request: Request): Promise<Response> => {
  const parsed = StopSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { message: "送信内容を確認してください。" });
  const { conversationId, requestId, shownSeq } = parsed.data;
  let env: Cloudflare.Env | undefined;
  try {
    // 所有境界（NFR-1）: URL のキャラと会話の character_id が違えば 404、部屋は呼ばん。
    await loadHistory({ characterId: id, conversationId });
    ({ env } = await getPlatform());
    const room = chatRoomFor(env, conversationId);
    const peek = await room.peek(requestId);
    if (peek === null) {
      // 受付が部屋に届く前に止めた場合も、後から届く送信を無効化するため印だけ書く。
      const missing = await room.stop(requestId);
      if (missing.outcome === "missing") {
        return json(404, { code: "missing", message: "この送信は見つかりません。" });
      }
    }
    const result = await room.stop(requestId);
    if (result.outcome === "missing") {
      return json(404, { code: "missing", message: "この送信は見つかりません。" });
    }
    if (result.outcome === "already_saved") {
      // 送信の受付が保存済みなら、画面に出てない塊を切り落としてから返す。
      return resolveSavedStop(
        env,
        room,
        id,
        conversationId,
        requestId,
        result.turn,
        shownSeq,
        peek === null ? "send" : peek.kind,
      );
    }
    return json(200, {
      outcome: result.outcome === "already_failed" ? "failed" : result.outcome,
      turn: result.turn,
    });
  } catch (error) {
    return toErrorResponse(error, env, "/api/chat/:id/stop");
  }
};
