import { z } from "zod/v4";

import { ensureAuthToken, getStoredAuthToken } from "@/lib/auth-session";
import { createLogger } from "@/lib/logger";
import { readMemoryExtractSince, writeMemoryExtractSince } from "@/lib/memory-extract-watermark";
import type { QualityCheckContext } from "@/lib/quality-guard";
import type { ScenePhase } from "@/lib/scene-phase";
import type { VisualMeta } from "@/schema/character-visual-enums";
import { visualMetaSchema } from "@/schema/character-visual-enums";

const logger = createLogger("api");
const GENERIC_API_ERROR_MESSAGE = "エラーが発生しました。再試行してください";

const streamMetaSchema = z.object({
  usedMemoryIds: z.array(z.string()).optional(),
});
const quotaErrorBodySchema = z.object({ error: z.string().optional() }).passthrough();

const classifyHttpStatus = (status: number): string => {
  if (status === 429) return "リクエスト制限に達しました。しばらく待ってから再試行してください";
  if (status === 401 || status === 403)
    return "認証エラーが発生しました。ページを再読み込みしてください";
  if (status === 0 || status === 503) return "接続できません。ネットワークを確認してください";
  if (status >= 500) return "サーバーエラーが発生しました。しばらく待ってから再試行してください";
  return GENERIC_API_ERROR_MESSAGE;
};

const errorStringClassifiers: { needles: string[]; message: string }[] = [
  {
    needles: ["rate_limited", "daily_limit", "monthly_cost"],
    message: "リクエスト制限に達しました。しばらく待ってから再試行してください",
  },
  {
    needles: ["Failed to fetch", "NetworkError", "ERR_NETWORK"],
    message: "ネットワークエラーが発生しました。接続を確認してください",
  },
  {
    needles: ["stream_error", "stream not found"],
    message: "ストリームエラーが発生しました。再試行してください",
  },
  { needles: ["content_blocked"], message: "コンテンツがブロックされました" },
  {
    needles: ["credit_exhausted"],
    message: "AIの利用枠が一時的に不足しています。時間をおいて試すか、運営にご連絡ください",
  },
  {
    needles: ["upstream_timeout"],
    message: "AIの応答がタイムアウトしました。しばらく待ってから再試行してください",
  },
  {
    needles: ["upstream_unavailable"],
    message: "AIが一時的に混み合っています。しばらく待ってから再試行してください",
  },
];

const classifyErrorString = (s: string): string =>
  errorStringClassifiers.find(({ needles }) => needles.some((needle) => s.includes(needle)))
    ?.message ?? GENERIC_API_ERROR_MESSAGE;

/**
 * P1-5: サーバー/ネットワークエラーをユーザー向けの分類済みメッセージに変換する。
 * 生のスタックトレースや内部詳細を UI に露出させない。
 */
export const classifyApiError = (statusOrErr: number | string | unknown): string => {
  if (typeof statusOrErr === "number") return classifyHttpStatus(statusOrErr);
  return classifyErrorString(String(statusOrErr));
};

// quality-meta SSE イベントのスキーマ（Phase 1 以降: ヘッダーではなく SSE で配信される）
const streamQualityMetaSchema = z.object({
  warningLevel: z.boolean(),
  refusalRetryCount: z.number(),
  retryCount: z.number().optional(),
  refusalDetected: z.boolean().optional(),
  usedModel: z.string().optional(),
});

const parseSseChunk = (data: string): string | "[DONE]" | null => {
  if (data === "[DONE]") return "[DONE]";
  try {
    const parsed: { choices?: Array<{ delta?: { content?: string } }> } = JSON.parse(data);
    return parsed.choices?.[0]?.delta?.content ?? null;
  } catch (error) {
    // SSEストリームでの不完全なJSONチャンクは正常の範囲なので次へ進む
    logger.error("failed to parse SSE chunk", error);
    return null;
  }
};

// UIの再レンダーを間引くため、チャンクをバッファして一定間隔でフラッシュする
const STREAM_FLUSH_INTERVAL_MS = 50;
// メッセージ件数の hard cap は撤廃 (会話を無限に続けられるように)。
// 上限はモデル context window に収まる char budget だけ。最新 turn を必ず残し、
// 古い turn は budget に収まるところまで取り込む。
// Sonnet 4 context window 200k tokens ≈ 600k chars。output 余裕と tool overhead を
// 引いた実用 input cap として 60k chars 使う。これにより長尺会話で
// より多くの古い turn が保持され、キャラ記憶 (序盤の関係構築 / 約束) が失われにくい。
const CHAT_TRANSPORT_MAX_CHARS = 60_000;

type ChatRequestMessage = { role: "system" | "user" | "assistant"; content: string };

const splitSystemMessage = (
  messages: ChatRequestMessage[],
): { systemMessage: ChatRequestMessage | null; history: ChatRequestMessage[] } => {
  const [firstMessage] = messages;
  if (firstMessage?.role !== "system") {
    return { systemMessage: null, history: messages };
  }
  return { systemMessage: firstMessage, history: messages.slice(1) };
};

const countMessageChars = (messages: ChatRequestMessage[]): number =>
  messages.reduce((sum, message) => sum + message.content.length, 0);

const withSystemMessage = (
  systemMessage: ChatRequestMessage | null,
  history: ChatRequestMessage[],
): ChatRequestMessage[] => (systemMessage ? [systemMessage, ...history] : history);

export const trimMessagesForTransport = (messages: ChatRequestMessage[]): ChatRequestMessage[] => {
  if (messages.length === 0) return messages;

  const { systemMessage, history } = splitSystemMessage(messages);
  const trimmedByCount = history;

  const totalChars = (systemMessage?.content.length ?? 0) + countMessageChars(trimmedByCount);
  if (totalChars <= CHAT_TRANSPORT_MAX_CHARS) {
    return withSystemMessage(systemMessage, trimmedByCount);
  }

  // system prompt が単体で budget を超える場合は他履歴を載せず system+latest user だけ残す。
  // 旧 turn を載せて新 turn を捨てると model が古い質問に答える致命バグになるため、必ず最新を優先する。
  const systemChars = systemMessage?.content.length ?? 0;
  const kept: ChatRequestMessage[] = [];
  let remainingBudget = Math.max(0, CHAT_TRANSPORT_MAX_CHARS - systemChars);
  // 最後の message (最新 user) は予算超過でも必ず載せる
  const lastIndex = trimmedByCount.length - 1;
  if (lastIndex >= 0) {
    kept.push(trimmedByCount[lastIndex]);
    remainingBudget -= trimmedByCount[lastIndex].content.length;
  }
  // 1 件でも予算超過したら以降の古い turn は不要 (時系列連続性を優先、飛ばし飛ばし注入を避ける)
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const message = trimmedByCount[index];
    if (remainingBudget - message.content.length < 0) break;
    kept.push(message);
    remainingBudget -= message.content.length;
  }

  kept.reverse();
  return withSystemMessage(systemMessage, kept);
};

const buildApiHeaders = (input: RequestInfo | URL, headersInit?: HeadersInit): Headers => {
  const headers = new Headers();
  if (input instanceof Request) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  if (headersInit) {
    new Headers(headersInit).forEach((value, key) => headers.set(key, value));
  }
  const token = getStoredAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
};

export const QUOTA_EXCEEDED_EVENT = "quota-exceeded";

const throwQuotaExceededIfNeeded = async (response: Response): Promise<void> => {
  if (response.status !== 429) return;
  const rawBody: unknown = await response.json().catch(() => ({}));
  const parsed = quotaErrorBodySchema.safeParse(rawBody);
  const body = parsed.success ? parsed.data : {};
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(QUOTA_EXCEEDED_EVENT, { detail: body }));
  }
  throw new Error(body.error ?? "rate_limited");
};

export class ApiResponseError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(`${message}: ${status}`);
    this.name = "ApiResponseError";
    this.status = status;
  }
}

// 「!response.ok なら `${label}: ${status}` を投げる」の同型ブロックが
// 37箇所重複していたための共通化。エラーメッセージの文言・型は元のまま。
const ensureOk = (response: Response, label: string): void => {
  if (!response.ok) {
    throw new Error(`${label}: ${response.status}`);
  }
};

const isAbortLikeError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError" || error.name === "TimeoutError"
    : error instanceof Error && /abort|timeout/i.test(error.name);

export const getCharacterListErrorMessage = (error: unknown): string => {
  if (!(error instanceof ApiResponseError)) {
    return "ネットワークに接続できません。通信状態を確認して再読み込みしてください。";
  }
  if (error.status === 401) return "ログインしてください。セッションが切れています。";
  if (error.status === 408)
    return "キャラクター取得がタイムアウトしました。再読み込みしてください。";
  if (error.status === 0) {
    return "ネットワークに接続できません。通信状態を確認して再読み込みしてください。";
  }
  if (error.status >= 500) {
    return "サーバー側でキャラクター取得に失敗しました。少し待って再読み込みしてください。";
  }
  return "キャラクターを取得できませんでした。再読み込みしてください。";
};

export const shouldRetryCharacterList = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ApiResponseError && [0, 401, 408].includes(error.status)) return false;
  return failureCount < 3;
};

// 取得が成功してキャラ一覧が出ている間は、直前の失敗で残った error で
// バナーを出さない。react-query の error は次の成功まで保持されるため、
// 初回のタイムアウト(408)後に取得が間に合っても error が消えず誤表示になっていた。
// 表示できるキャラが 1 件も無いときだけ、本物の失敗としてバナー+再試行を出す。
export const shouldShowCharacterListError = (error: unknown, hasCharacters: boolean): boolean => {
  if (!error) return false;
  return !hasCharacters;
};

// 会話メッセージの永続化はチャットの送信ロック解除条件になっており、
// 無期限に待つと composer が二度と開かない。
const MESSAGE_PERSIST_TIMEOUT_MS = 20_000;

// 画像生成パイプラインの HTTP 上限。値はサーバー側の provider 呼び出し上限
// （Novita/Runware の init/poll タイムアウト）に余裕を持たせたもの。
const IMAGE_GENERATE_TIMEOUT_MS = 60_000;
const IMAGE_TASK_RESULT_TIMEOUT_MS = 45_000;
const IMAGE_PERSIST_TIMEOUT_MS = 120_000;

type ApiFetchInit = RequestInit & { timeoutMs?: number };

const buildFetchSignal = (
  init: RequestInit | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined => {
  if (timeoutMs === undefined) return init?.signal ?? undefined;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
};

export const apiFetch = async (
  input: RequestInfo | URL,
  init?: ApiFetchInit,
): Promise<Response> => {
  const { timeoutMs, ...restInit } = init ?? {};
  const makeSignal = () => buildFetchSignal(restInit, timeoutMs);
  const response = await fetch(input, {
    ...restInit,
    headers: buildApiHeaders(input, restInit.headers),
    redirect: "follow",
    signal: makeSignal(),
  });
  // 401 かつアプリ JWT のリフレッシュが可能なら 1 回だけ retry する
  if (response.status === 401) {
    await ensureAuthToken();
    const retryResponse = await fetch(input, {
      ...restInit,
      headers: buildApiHeaders(input, restInit.headers),
      redirect: "follow",
      signal: makeSignal(),
    });
    await throwQuotaExceededIfNeeded(retryResponse);
    return retryResponse;
  }

  await throwQuotaExceededIfNeeded(response);
  return response;
};

const classifyApiResponseError = async (response: Response): Promise<string> => {
  const rawBody = (await response.text().catch(() => "")).trim();
  const bodyMessage = rawBody ? classifyApiError(rawBody) : GENERIC_API_ERROR_MESSAGE;
  return bodyMessage === GENERIC_API_ERROR_MESSAGE
    ? classifyApiError(response.status)
    : bodyMessage;
};

type SseLineResult = "done" | "continue";

export interface ChatStreamResult {
  content: string;
  warningLevel?: boolean;
  usedMemoryIds?: string[];
  refusalRetryCount?: number;
  retryCount?: number;
  refusalDetected?: boolean;
  usedModel?: string;
  scenePhase?: ScenePhase;
  upstreamError?: string;
  // Phase 1 以降: onRegenerate はサーバーサイドリトライ通知のスキャフォールディング（未使用）
  onRegenerate?: () => void;
}

const applySseMetaEvent = (rawJson: string, metadata: ChatStreamResult): void => {
  try {
    const parsed = streamMetaSchema.safeParse(JSON.parse(rawJson));
    if (parsed.success) metadata.usedMemoryIds = parsed.data.usedMemoryIds;
  } catch (error) {
    logger.error("failed to parse SSE meta", error);
  }
};

const applySseQualityMetaEvent = (rawJson: string, metadata: ChatStreamResult): void => {
  try {
    const parsed = streamQualityMetaSchema.safeParse(JSON.parse(rawJson));
    if (parsed.success) {
      metadata.warningLevel = parsed.data.warningLevel;
      metadata.refusalRetryCount = parsed.data.refusalRetryCount;
      if (parsed.data.retryCount !== undefined) metadata.retryCount = parsed.data.retryCount;
      if (parsed.data.refusalDetected !== undefined)
        metadata.refusalDetected = parsed.data.refusalDetected;
      if (parsed.data.usedModel !== undefined) metadata.usedModel = parsed.data.usedModel;
    }
  } catch (error) {
    logger.error("failed to parse SSE quality-meta", error);
  }
};

const applySseErrorEvent = (rawJson: string, metadata: ChatStreamResult): void => {
  try {
    const parsed = z.object({ reason: z.string() }).safeParse(JSON.parse(rawJson));
    if (parsed.success) metadata.upstreamError = parsed.data.reason;
  } catch (error) {
    logger.error("failed to parse SSE error event", error);
  }
};

// 名前付き SSE イベント（meta / quality-meta / regenerating / error）を処理しメタデータを更新する
const applyNamedSseEvent = (
  eventType: string,
  dataLine: string,
  metadata: ChatStreamResult,
): void => {
  const rawJson = dataLine.slice(6).trim();
  if (eventType === "meta") applySseMetaEvent(rawJson, metadata);
  else if (eventType === "quality-meta") applySseQualityMetaEvent(rawJson, metadata);
  else if (eventType === "regenerating") metadata.onRegenerate?.();
  else if (eventType === "error") applySseErrorEvent(rawJson, metadata);
};

// 作り直し通知が来たら、まだ onChunk へ吐き出してない中継分も捨てる。本文は 50ms の
// フラッシュ待ちに溜まるだけなので、捨てたはずの試行の末尾が次の採用本文の頭へ混ざる。
const discardPendingChunks = (state: StreamState): void => {
  state.pendingChunks = "";
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
};

const processSseLine = (line: string, state: StreamState): SseLineResult => {
  if (line === "") {
    state.currentEvent = null;
    return "continue";
  }
  if (line.startsWith("event: ")) {
    state.currentEvent = line.slice(7).trim();
    return "continue";
  }
  if (!line.startsWith("data: ")) return "continue";
  if (state.currentEvent !== null) {
    if (state.currentEvent === "regenerating") discardPendingChunks(state);
    applyNamedSseEvent(state.currentEvent, line, state.metadata);
    return "continue";
  }

  const result = parseSseChunk(line.slice(6).trim());
  if (result === "[DONE]") return "done";
  if (!result) return "continue";

  state.pendingChunks += result;
  return "continue";
};

// 無データが続く場合にストリームをタイムアウトさせる閾値
const STREAM_STALL_TIMEOUT_MS = 180_000;

type StreamState = {
  pendingChunks: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  currentEvent: string | null;
  metadata: ChatStreamResult;
};

const processStreamLines = (
  lines: string[],
  state: StreamState,
  flush: () => void,
): "done" | "continue" => {
  for (const line of lines) {
    const lineResult = processSseLine(line, state);
    if (lineResult === "done") return "done";
    if (lineResult === "continue" && state.pendingChunks && !state.flushTimer) {
      state.flushTimer = setTimeout(flush, STREAM_FLUSH_INTERVAL_MS);
    }
  }
  return "continue";
};

const parseScenePhaseHeader = (value: string | null): ScenePhase | undefined => {
  const parsed = z
    .enum(["conversation", "intimate", "erotic", "climax", "afterglow"])
    .safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const processStream = async (
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
  onDone: (result: ChatStreamResult) => void,
  onError: (error: string) => void,
  onRegenerate?: () => void,
  scenePhase?: ScenePhase,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: StreamState = {
    pendingChunks: "",
    flushTimer: null,
    currentEvent: null,
    metadata: { content: "", onRegenerate, scenePhase },
  };

  const flush = () => {
    if (state.pendingChunks) {
      onChunk(state.pendingChunks);
      state.pendingChunks = "";
    }
    state.flushTimer = null;
  };

  const cleanup = () => {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    flush();
  };

  const finishWithMetadata = (metadata: ChatStreamResult): void => {
    if (metadata.upstreamError) {
      onError(classifyApiError(metadata.upstreamError));
    } else {
      onDone(metadata);
    }
  };

  // チャンク受信を待つ際にストール検知タイムアウトを設ける。
  // finally で timer を解放し、正常チャンク受信後に timer が残留しないようにする。
  const readWithTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(
        () => reject(new Error("stream_stall_timeout")),
        STREAM_STALL_TIMEOUT_MS,
      );
    });
    return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timerId));
  };

  try {
    while (true) {
      const { done, value } = await readWithTimeout();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      if (processStreamLines(lines, state, flush) === "done") {
        cleanup();
        finishWithMetadata(state.metadata);
        return;
      }
    }
    cleanup();
    finishWithMetadata(state.metadata);
  } catch (error) {
    cleanup();
    reader.cancel().catch(() => undefined);
    const message = error instanceof Error ? error.message : "stream_error";
    logger.error("processStream error", error);
    onError(classifyApiError(message));
  }
};

export const streamChat = async (
  messages: ChatRequestMessage[],
  model: string,
  onChunk: (text: string) => void,
  onDone: (result: ChatStreamResult) => void,
  onError: (error: string) => void,
  characterId?: string,
  responseLength?: "short" | "medium" | "long" | "very_long",
  conversationId?: string,
  scenePhase?: ScenePhase,
  onRegenerate?: () => void,
): Promise<void> => {
  try {
    const transportMessages = trimMessagesForTransport(messages);
    // keepalive は使わない: keepalive リクエストのボディには 64KiB 上限があり、日本語(UTF-8で約3byte/字)の長尺会話では超過して fetch が TypeError で即失敗する（送信自体が不可能になる）。ストリーミング応答はユーザーが前面で待つ想定で beacon 用途ではないため確実な送信を優先する
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(conversationId ? { "x-conversation-id": conversationId } : {}),
      },
      body: JSON.stringify({
        messages: transportMessages,
        model,
        characterId,
        responseLength,
        ...(scenePhase ? { scenePhase } : {}),
      }),
    });

    if (!response.ok || !response.body) {
      onError(await classifyApiResponseError(response));
      return;
    }

    let accumulated = "";
    await processStream(
      response.body,
      (chunk) => {
        accumulated += chunk;
        onChunk(chunk);
      },
      (result) => {
        const doneResult: ChatStreamResult = {
          content: accumulated,
          warningLevel: result.warningLevel ?? false,
          usedMemoryIds: result.usedMemoryIds ?? [],
          refusalRetryCount: result.refusalRetryCount ?? 0,
        };
        if (result.scenePhase) doneResult.scenePhase = result.scenePhase;
        onDone(doneResult);
      },
      onError,
      onRegenerate,
      parseScenePhaseHeader(response.headers.get("x-scene-phase")),
    );
  } catch (err) {
    logger.error("streamChat failed", err);
    onError(classifyApiError(err));
  }
};

export const streamChatWithQualityGuard = async (
  messages: ChatRequestMessage[],
  model: string,
  onChunk: (text: string) => void,
  onDone: (result: ChatStreamResult) => void,
  onError: (error: string) => void,
  qualityContext: QualityCheckContext,
  characterId?: string,
  responseLength?: "short" | "medium" | "long" | "very_long",
  streamId?: string,
  conversationId?: string,
  onRegenerate?: () => void,
  // 品質測定の行を、実際に配信された返信へ紐づけるためだけに送る。応答の中身は変わらん。
  // assistant の行はストリーム中には存在せず、終わってから別リクエストで作られるので、
  // サーバ側では id を知りようがない。採番はここより前なので、送れば埋まる。
  assistantMessageId?: string,
): Promise<void> => {
  try {
    const transportMessages = trimMessagesForTransport(messages);
    // keepalive は使わない: keepalive リクエストのボディには 64KiB 上限があり、日本語(UTF-8で約3byte/字)の長尺会話では超過して fetch が TypeError で即失敗する（送信自体が不可能になる）。ストリーミング応答はユーザーが前面で待つ想定で beacon 用途ではないため確実な送信を優先する
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(conversationId ? { "x-conversation-id": conversationId } : {}),
        ...(assistantMessageId ? { "x-assistant-message-id": assistantMessageId } : {}),
      },
      body: JSON.stringify({
        messages: transportMessages,
        model,
        characterId,
        responseLength,
        ...(streamId ? { streamId } : {}),
        // クライアント側で算出したフェーズをサーバーに渡し、自動昇格を防ぐ
        scenePhase: qualityContext.phase,
      }),
    });

    if (!response.ok || !response.body) {
      onError(await classifyApiResponseError(response));
      return;
    }

    // Phase 1: warningLevel は x-quality-warning ヘッダーではなく quality-meta SSE イベントから取得する。
    // processStream が state.metadata.warningLevel を解決した結果を onDone に渡す。
    let accumulated = "";
    await processStream(
      response.body,
      (chunk) => {
        accumulated += chunk;
        onChunk(chunk);
      },
      (result) => {
        const doneResult: ChatStreamResult = {
          content: accumulated,
          warningLevel: result.warningLevel ?? false,
          usedMemoryIds: result.usedMemoryIds,
        };
        if (result.refusalRetryCount !== undefined)
          doneResult.refusalRetryCount = result.refusalRetryCount;
        if (result.retryCount !== undefined) doneResult.retryCount = result.retryCount;
        if (result.refusalDetected !== undefined)
          doneResult.refusalDetected = result.refusalDetected;
        if (result.usedModel !== undefined) doneResult.usedModel = result.usedModel;
        if (result.scenePhase !== undefined) doneResult.scenePhase = result.scenePhase;
        onDone(doneResult);
      },
      (error) => {
        onError(error);
      },
      onRegenerate
        ? () => {
            accumulated = "";
            onRegenerate();
          }
        : undefined,
      parseScenePhaseHeader(response.headers.get("x-scene-phase")),
    );
  } catch (err) {
    logger.error("streamChatWithQualityGuard failed", err);
    onError(classifyApiError(err));
  }
};

const generateImageResponseSchema = z.union([
  z.object({
    task_id: z.string(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    loraModel: z.string().nullable().optional(),
    loraWeight: z.number().nullable().optional(),
    loraTriggerPrompt: z.string().nullable().optional(),
  }),
  z.object({ error: z.string() }),
]);

export const generateImage = async (
  prompt: string,
  characterDescription?: string,
  phase?: ScenePhase,
  characterId?: string,
  conversationId?: string,
  provider?: "auto" | "novita",
): Promise<
  | {
      task_id: string;
      prompt?: string;
      model?: string;
      loraModel?: string | null;
      loraWeight?: number | null;
      loraTriggerPrompt?: string | null;
    }
  | { error: string }
> => {
  try {
    const response = await apiFetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
      body: JSON.stringify({
        prompt,
        characterDescription: characterDescription ?? "",
        characterId: characterId ?? undefined,
        conversationId: conversationId ?? undefined,
        negative_prompt: "ugly, deformed, blurry, low quality, text, watermark",
        width: 768,
        height: 1024,
        phase: phase ?? "conversation",
        ...(provider && provider !== "auto" ? { provider } : {}),
      }),
    });
    if (!response.ok) {
      return { error: await response.text() };
    }
    return generateImageResponseSchema.parse(await response.json());
  } catch (err) {
    return { error: String(err) };
  }
};

const imageProvidersSchema = z.object({
  novita: z.boolean(),
  runware: z.boolean().optional(),
});

export const getImageProviders = async (): Promise<{ novita: boolean; runware?: boolean }> => {
  try {
    const response = await apiFetch("/api/image/providers");
    if (!response.ok) return { novita: true };
    return imageProvidersSchema.parse(await response.json());
  } catch {
    return { novita: true };
  }
};

const novitaTaskResultSchema = z
  .object({
    task: z.object({
      task_id: z.string(),
      status: z.enum([
        "TASK_STATUS_QUEUED",
        "TASK_STATUS_PROCESSING",
        "TASK_STATUS_SUCCEED",
        "TASK_STATUS_FAILED",
        "TASK_STATUS_CANCELED",
      ]),
      progress_percent: z.number().optional(),
    }),
    images: z
      .array(
        z
          .object({
            image_url: z.string(),
            seed: z.union([z.string(), z.number()]).optional(),
            image_seed: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

type NovitaTaskResult = z.infer<typeof novitaTaskResultSchema>;

export const getImageTaskResult = async (taskId: string): Promise<NovitaTaskResult> => {
  const response = await apiFetch(`/api/image/task/${encodeURIComponent(taskId)}`, {
    timeoutMs: IMAGE_TASK_RESULT_TIMEOUT_MS,
  });
  ensureOk(response, "task result fetch failed");
  return novitaTaskResultSchema.parse(await response.json());
};

// ── 会話 ──────────────────────────────────────────────────────────────────

const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  characterId: z.string(),
  characterName: z.string(),
  characterGreeting: z.string(),
  characterSystemPrompt: z.string(),
  characterAvatar: z.string().nullable(),
  parentConversationId: z.string().nullable().optional(),
  branchedFromMessageId: z.string().nullable().optional(),
  parentTitle: z.string().nullable().optional(),
  greetingMessageId: z.string().nullable().optional(),
  // C1: 直近のAI応答プレビュー（50字）
  lastAssistantMessage: z.string().optional(),
});

const listConversationsSchema = z.object({
  conversations: z.array(conversationSummarySchema),
});

const createConversationSchema = z.object({
  conversation: conversationSummarySchema,
});

const createConversationShareSchema = z.object({
  shareId: z.string(),
  createdAt: z.number(),
});

const generateTitleResponseSchema = z.object({
  title: z.string().optional(),
});

export const suggestionResponseSchema = z.object({
  suggestions: z.array(z.string()),
});

export const meResponseSchema = z.object({
  email: z.string(),
  logoutUrl: z.string().nullable(),
  isLocal: z.boolean(),
  // #1224/#1228: アカウント単位の呼ばれ方の既定値
  displayName: z.string().nullable().optional(),
});

export class SuggestionFetchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`fetch suggestions failed: ${status}`);
    this.name = "SuggestionFetchError";
    this.status = status;
  }
}

export type MessageFeedbackRating = "good" | "bad";

const persistedMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  imageUrl: z.string().nullable().optional(),
  imageKey: z.string().nullable().optional(),
  imagePrompt: z.string().nullable().optional(),
  imageSeed: z.string().nullable().optional(),
  imageLoraModel: z.string().nullable().optional(),
  imageLoraWeight: z.number().nullable().optional(),
  imageLoraTriggerPrompt: z.string().nullable().optional(),
  feedbackRating: z.enum(["good", "bad"]).nullable().optional(),
  generationModel: z.string().nullable().optional(),
  generationPhase: z
    .enum(["conversation", "intimate", "erotic", "climax", "afterglow"])
    .nullable()
    .optional(),
  createdAt: z.number(),
});

const listMessagesSchema = z.object({
  messages: z.array(persistedMessageSchema),
});

const messageSearchResultSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  conversationTitle: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  snippet: z.string(),
  createdAt: z.number(),
  characterName: z.string(),
  characterAvatar: z.string().nullable(),
});

const messageSearchSchema = z.object({
  results: z.array(messageSearchResultSchema),
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type PersistedMessage = z.infer<typeof persistedMessageSchema>;
export type MessageSearchResult = z.infer<typeof messageSearchResultSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;

const memoryNoteSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  content: z.string(),
  sourceMessageId: z.string().nullable().optional(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable().optional(),
  usageCount: z.number().optional(),
  characterName: z.string().nullable().optional(),
  characterAvatar: z.string().nullable().optional(),
});

const memoryNotesSchema = z.object({
  notes: z.array(memoryNoteSchema),
});

export const sceneBookmarkSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  title: z.string(),
  snippet: z.string(),
  characterName: z.string(),
  characterId: z.string().nullable(),
  createdAt: z.number(),
});

const sceneBookmarksSchema = z.object({
  items: z.array(sceneBookmarkSchema),
  nextCursor: z.number().nullable(),
});

const sceneBookmarkResponseSchema = z.object({
  bookmark: sceneBookmarkSchema,
});

const galleryImageSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  conversationTitle: z.string(),
  characterId: z.string(),
  characterName: z.string(),
  characterAvatar: z.string().nullable(),
  imageUrl: z.string().nullable(),
  imageKey: z.string().nullable().optional(),
  content: z.string(),
  createdAt: z.number(),
});

const galleryImagesSchema = z.object({
  images: z.array(galleryImageSchema),
});
const characterGallerySchema = z.object({
  items: z.array(
    z.object({
      image_url: z.string(),
      created_at: z.number(),
      message_id: z.string(),
      conversation_id: z.string(),
    }),
  ),
  next_cursor: z.number().nullable(),
});

export type MemoryNote = z.infer<typeof memoryNoteSchema>;
export type SceneBookmark = z.infer<typeof sceneBookmarkSchema>;
export type GalleryImage = z.infer<typeof galleryImageSchema>;

export const fetchCurrentUser = async (): Promise<MeResponse> => {
  const response = await apiFetch("/api/me");
  ensureOk(response, "fetch current user failed");
  return meResponseSchema.parse(await response.json());
};

const updateMyDisplayNameResponseSchema = z.object({
  displayName: z.string().nullable(),
});

// #1224/#1228: アカウント単位の呼ばれ方を保存する。空文字は未設定へ戻す。
export const updateMyDisplayName = async (displayName: string): Promise<string | null> => {
  const response = await apiFetch("/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  ensureOk(response, "update display name failed");
  return updateMyDisplayNameResponseSchema.parse(await response.json()).displayName;
};

export const listConversations = async (): Promise<ConversationSummary[]> => {
  const response = await apiFetch("/api/conversations");
  ensureOk(response, "list conversations failed");
  return listConversationsSchema.parse(await response.json()).conversations;
};

export const createConversation = async (input?: {
  title?: string;
  characterId?: string;
}): Promise<ConversationSummary> => {
  const response = await apiFetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input?.title, characterId: input?.characterId }),
  });
  ensureOk(response, "create conversation failed");
  return createConversationSchema.parse(await response.json()).conversation;
};

export const branchConversation = async (input: {
  conversationId: string;
  messageId: string;
  title?: string;
}): Promise<ConversationSummary> => {
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/branch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: input.messageId, title: input.title }),
    },
  );
  ensureOk(response, "branch conversation failed");
  return createConversationSchema.parse(await response.json()).conversation;
};

export const listBranches = async (conversationId: string): Promise<ConversationSummary[]> => {
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/branches`,
  );
  ensureOk(response, "list branches failed");
  return listConversationsSchema.parse(await response.json()).conversations;
};

export const deleteConversation = async (conversationId: string): Promise<void> => {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
  ensureOk(response, "delete conversation failed");
};

export const deleteAllConversations = async (): Promise<void> => {
  const response = await apiFetch("/api/conversations", {
    method: "DELETE",
  });
  ensureOk(response, "delete all conversations failed");
};

// share burst レート制限（429）を呼び出し側で握れるよう、retryAfterSec を載せて投げる。
export class ShareRateLimitError extends Error {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number) {
    super(`share rate limited: retry after ${retryAfterSec}s`);
    this.name = "ShareRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

export const createConversationShare = async (
  conversationId: string,
): Promise<{ shareId: string }> => {
  const response = await apiFetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId }),
  });
  if (response.status === 429) {
    // backend は { error: "rate_limited", retryAfterSec } を返す。Retry-After header も同値。
    const body = (await response.json().catch(() => null)) as { retryAfterSec?: unknown } | null;
    const retryAfterSec =
      typeof body?.retryAfterSec === "number" && body.retryAfterSec > 0
        ? Math.ceil(body.retryAfterSec)
        : 10;
    throw new ShareRateLimitError(retryAfterSec);
  }
  if (!response.ok) {
    throw new ApiResponseError("create conversation share failed", response.status);
  }
  const { shareId } = createConversationShareSchema.parse(await response.json());
  return { shareId };
};

const sharedConversationSchema = z.object({
  shareId: z.string().min(1),
  createdAt: z.number(),
  payload: z.object({
    conversationId: z.string(),
    title: z.string().nullable(),
    character: z.object({
      id: z.string(),
      name: z.string(),
      avatar: z.string().nullable(),
    }),
    messages: z.array(
      z.object({
        id: z.string(),
        role: z.string(),
        content: z.string(),
        imageUrl: z.string().nullable(),
        createdAt: z.number(),
      }),
    ),
    now: z.number(),
  }),
});

export type SharedConversation = z.infer<typeof sharedConversationSchema>;

// shareId 単体で（認証なしで）共有スナップショットを取得する。
// 404 → not_found / 410 → payload_corrupt を ApiResponseError の status で握らせる。
export const fetchSharedConversation = async (shareId: string): Promise<SharedConversation> => {
  const response = await apiFetch(`/api/share/${encodeURIComponent(shareId)}`);
  if (!response.ok) {
    throw new ApiResponseError("fetch shared conversation failed", response.status);
  }
  return sharedConversationSchema.parse(await response.json());
};

export const updateConversationTitle = async (
  conversationId: string,
  title: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/title`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  ensureOk(response, "update conversation title failed");
};

export const updateConversationCharacter = async (
  conversationId: string,
  characterId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/character`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId }),
    },
  );
  ensureOk(response, "update conversation character failed");
};

export const generateConversationTitle = async (
  conversationId: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  model: string,
): Promise<string | null> => {
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/generate-title`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model }),
    },
  );
  if (!response.ok) return null;
  const data = generateTitleResponseSchema.parse(await response.json());
  return data.title ?? null;
};

export const fetchContextualSuggestions = async (input: {
  conversationId: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  scenePhase?: ScenePhase;
  characterId: string;
}): Promise<string[]> => {
  const response = await apiFetch("/api/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new SuggestionFetchError(response.status);
  }
  return suggestionResponseSchema.parse(await response.json()).suggestions;
};

// 「なんて言おう」で出すプレイヤー側の発言候補。行動の促し文を返す
// fetchContextualSuggestions とは別物なので、エンドポイントも分けとる。
export const fetchReplySuggestions = async (input: {
  // 会話行が出来る前（1手目）にも呼ぶ。undefined のキーを送ると型が合わんので、
  // 在る時だけ積む。
  conversationId?: string;
  characterId: string;
}): Promise<string[]> => {
  const response = await apiFetch("/api/reply-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      input.conversationId === undefined
        ? { characterId: input.characterId }
        : { characterId: input.characterId, conversationId: input.conversationId },
    ),
  });
  if (!response.ok) {
    throw new SuggestionFetchError(response.status);
  }
  return suggestionResponseSchema.parse(await response.json()).suggestions;
};

export const listConversationMessages = async (
  conversationId: string,
  options?: { timeoutMs?: number },
): Promise<PersistedMessage[]> => {
  // 保存の在否を読み直す用途で呼ぶ経路があるため、上限を渡せるようにする。
  // 上限が無いと、接続が固まった時にこの await が返らず、呼び出し側の finally に
  // 届かないまま入力欄が永久に disabled で残る。
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    options?.timeoutMs === undefined
      ? undefined
      : { signal: AbortSignal.timeout(options.timeoutMs) },
  );
  // 会話が D1 から消えとると 404 が返る。呼び出し側は「もう無い」を「通信が届かん」と
  // 分けて画面を戻さなあかんので、status を型で渡す（文言は ensureOk と同一）。
  if (!response.ok) {
    throw new ApiResponseError("list messages failed", response.status);
  }
  return listMessagesSchema.parse(await response.json()).messages;
};

export const searchConversationMessages = async (
  query: string,
  limit = 25,
): Promise<MessageSearchResult[]> => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const params = new URLSearchParams({
    q: normalizedQuery,
    limit: String(limit),
  });
  const response = await apiFetch(`/api/conversations/search/messages?${params.toString()}`);
  ensureOk(response, "search messages failed");
  return messageSearchSchema.parse(await response.json()).results;
};

export const listMemoryNotes = async (characterId?: string | null): Promise<MemoryNote[]> => {
  const params = new URLSearchParams();
  if (characterId) params.set("characterId", characterId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`/api/memory-notes${suffix}`);
  ensureOk(response, "list memory notes failed");
  return memoryNotesSchema.parse(await response.json()).notes;
};

export const createMemoryNote = async (input: {
  characterId: string;
  content: string;
}): Promise<MemoryNote> => {
  const response = await apiFetch("/api/memory-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  ensureOk(response, "create memory note failed");
  return z.object({ note: memoryNoteSchema }).parse(await response.json()).note;
};

export const updateMemoryNote = async (noteId: string, content: string): Promise<void> => {
  const response = await apiFetch(`/api/memory-notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  ensureOk(response, "update memory note failed");
};

export const deleteMemoryNote = async (noteId: string): Promise<void> => {
  const response = await apiFetch(`/api/memory-notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
  ensureOk(response, "delete memory note failed");
};

const memoryExtractResultSchema = z.object({
  inserted: z.number(),
  facts: z.array(
    z.object({
      characterId: z.string(),
      content: z.string(),
      importance: z.number(),
      sourceMessageIds: z.array(z.string()),
    }),
  ),
  // サーバが実際に読んだ最新メッセージの時刻。次回の since に使う。
  // 抽出が走らんかった回は返ってこん（読んだだけの往復を飛ばさんため）。
  nextSince: z.number().optional(),
});

export type MemoryExtractResult = z.infer<typeof memoryExtractResultSchema>;

// 直近の往復から覚えるべきことを抜いて memory_note へ入れる。抽出も重複除去も
// 挿入もサーバ側で完結しとるので、ここは呼ぶだけ（A2: 呼び出し側が 0 件やった）。
//
// since を送らんとサーバは毎回直近50件を読む。会話が伸びるほど、同じ往復を毎ターン
// 抽出モデルへ食わせ直すことになるので、前回サーバが読んだ境界を送って差分だけ見せる。
export const extractMemoryNotes = async (input: {
  conversationId: string;
  characterId: string;
}): Promise<MemoryExtractResult> => {
  const since = readMemoryExtractSince(input.conversationId);
  const response = await apiFetch("/api/memory/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(since === undefined ? input : { ...input, since }),
  });
  ensureOk(response, "extract memory notes failed");
  const result = memoryExtractResultSchema.parse(await response.json());
  if (result.nextSince !== undefined) {
    writeMemoryExtractSince(input.conversationId, result.nextSince);
  }
  return result;
};

export const listSceneBookmarks = async (params: {
  characterId?: string;
  q?: string;
  limit?: number;
  cursor?: number;
}): Promise<{ items: SceneBookmark[]; nextCursor: number | null }> => {
  const searchParams = new URLSearchParams();
  if (params.characterId) searchParams.set("characterId", params.characterId);
  if (params.q?.trim()) searchParams.set("q", params.q.trim());
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  if (params.cursor !== undefined) searchParams.set("cursor", String(params.cursor));
  const suffix = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const response = await apiFetch(`/api/scene-bookmarks${suffix}`);
  ensureOk(response, "list scene bookmarks failed");
  return sceneBookmarksSchema.parse(await response.json());
};

export const createSceneBookmark = async (input: {
  id?: string;
  conversationId: string;
  messageId: string;
  title: string;
  snippet: string;
  characterName: string;
  characterId?: string;
}): Promise<SceneBookmark> => {
  const response = await apiFetch("/api/scene-bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  ensureOk(response, "create scene bookmark failed");
  return sceneBookmarkResponseSchema.parse(await response.json()).bookmark;
};

export const renameSceneBookmark = async (
  bookmarkId: string,
  title: string,
): Promise<SceneBookmark> => {
  const response = await apiFetch(`/api/scene-bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  ensureOk(response, "rename scene bookmark failed");
  return sceneBookmarkResponseSchema.parse(await response.json()).bookmark;
};

export const deleteSceneBookmark = async (bookmarkId: string): Promise<void> => {
  const response = await apiFetch(`/api/scene-bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: "DELETE",
  });
  ensureOk(response, "delete scene bookmark failed");
};

export const listGalleryImages = async (): Promise<GalleryImage[]> => {
  const response = await apiFetch("/api/gallery/images");
  ensureOk(response, "list gallery images failed");
  return galleryImagesSchema.parse(await response.json()).images;
};

export type CharacterGalleryItem = z.infer<typeof characterGallerySchema>["items"][number];
export const listCharacterGallery = async (input: {
  characterId: string;
  limit?: number;
  cursor?: number;
}): Promise<{ items: CharacterGalleryItem[]; nextCursor: number | null }> => {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor !== undefined) params.set("cursor", String(input.cursor));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(
    `/api/character/${encodeURIComponent(input.characterId)}/gallery${suffix}`,
  );
  ensureOk(response, "list character gallery failed");
  const parsed = characterGallerySchema.parse(await response.json());
  return { items: parsed.items, nextCursor: parsed.next_cursor };
};

export const createConversationMessage = async (input: {
  conversationId: string;
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  imageUrl?: string;
  imageKey?: string;
  imagePrompt?: string | null;
  imageSeed?: string | null;
  imageLoraModel?: string | null;
  imageLoraWeight?: number | null;
  imageLoraTriggerPrompt?: string | null;
  retryCount?: number;
  refusalDetected?: boolean;
  generationModel?: string;
  generationPhase?: ScenePhase;
  // 待つのをやめた呼び出し側が、この往復そのものを止めるための口。
  // 待ちを切るだけでは行が後から書かれる（use-chat-query.ts の期限を参照）。
  signal?: AbortSignal;
}): Promise<void> => {
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(input.conversationId)}/messages`,
    {
      method: "POST",
      // 送信ロックはこの往復の完了で解ける。timeout が無いとハングがそのまま
      // 「入力欄が永久に disabled」になるため、必ず期限を切って失敗させる。
      // 呼び出し側の signal は畳んで渡す。片方でも中断すれば送信は止まる。
      signal:
        input.signal === undefined
          ? AbortSignal.timeout(MESSAGE_PERSIST_TIMEOUT_MS)
          : AbortSignal.any([input.signal, AbortSignal.timeout(MESSAGE_PERSIST_TIMEOUT_MS)]),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: input.id,
        role: input.role,
        content: input.content,
        imageUrl: input.imageUrl,
        imageKey: input.imageKey,
        imagePrompt: input.imagePrompt,
        imageSeed: input.imageSeed,
        imageLoraModel: input.imageLoraModel,
        imageLoraWeight: input.imageLoraWeight,
        imageLoraTriggerPrompt: input.imageLoraTriggerPrompt,
        retryCount: input.retryCount,
        refusalDetected: input.refusalDetected,
        generationModel: input.generationModel,
        generationPhase: input.generationPhase,
      }),
    },
  );
  ensureOk(response, "create message failed");
};

export const deleteMessagesAfterMessage = async (
  conversationId: string,
  messageId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages-after/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );
  ensureOk(response, "delete messages after failed");
};

export const submitMessageFeedback = async (
  messageId: string,
  rating: MessageFeedbackRating,
  reason?: string,
): Promise<void> => {
  const response = await apiFetch(`/api/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating, ...(reason ? { reason } : {}) }),
  });
  ensureOk(response, "submit message feedback failed");
};

// 消そうとした行がもう無かった。エンドポイントは削除0件の時に 404 を返す
// （functions/api/[[route]].ts の DELETE /conversations/:id/messages/:messageId）。
// 「消えとる」と「消せんかった」を呼び出し側が見分けられるよう、型で区別して投げる。
// 呼び出し側にステータス文字列を突き合わせさせると、他の 404 まで巻き込んで握り潰す。
export class MessageAlreadyDeletedError extends Error {
  readonly messageId: string;

  constructor(messageId: string) {
    super(`delete message failed: 404 (already deleted: ${messageId})`);
    this.name = "MessageAlreadyDeletedError";
    this.messageId = messageId;
  }
}

export const deleteConversationMessage = async (
  conversationId: string,
  messageId: string,
): Promise<void> => {
  const response = await apiFetch(
    "/api/conversations/" +
      encodeURIComponent(conversationId) +
      "/messages/" +
      encodeURIComponent(messageId),
    // 永続化失敗時のロールバックもロック解除の手前に居るため同じ期限を切る。
    { method: "DELETE", signal: AbortSignal.timeout(MESSAGE_PERSIST_TIMEOUT_MS) },
  );
  if (response.status === 404) {
    throw new MessageAlreadyDeletedError(messageId);
  }
  if (!response.ok) {
    throw new Error("delete message failed: " + response.status);
  }
};

export const updateMessageImage = async (input: {
  messageId: string;
  imageUrl?: string;
  imageKey?: string;
  imagePrompt?: string | null;
  imageSeed?: string | null;
  imageLoraModel?: string | null;
  imageLoraWeight?: number | null;
  imageLoraTriggerPrompt?: string | null;
}): Promise<void> => {
  const response = await apiFetch(`/api/messages/${encodeURIComponent(input.messageId)}/image`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageUrl: input.imageUrl,
      imageKey: input.imageKey,
      imagePrompt: input.imagePrompt,
      imageSeed: input.imageSeed,
      imageLoraModel: input.imageLoraModel,
      imageLoraWeight: input.imageLoraWeight,
      imageLoraTriggerPrompt: input.imageLoraTriggerPrompt,
    }),
  });
  ensureOk(response, "update message image failed");
};

const persistImageToR2ResponseSchema = z.union([
  z.object({ imageKey: z.string() }),
  z.object({ error: z.string() }),
]);

// エフェメラルなS3 URLをR2に永続化し、imageKeyを返す。
// taskId を渡すと E5 コンテンツハッシュキャッシュに書き込まれる。
export const persistImageToR2 = async (
  imageUrl: string,
  messageId: string,
  taskId?: string,
): Promise<{ imageKey: string } | { error: string }> => {
  try {
    const response = await apiFetch("/api/image/persist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: IMAGE_PERSIST_TIMEOUT_MS,
      body: JSON.stringify({ imageUrl, messageId, ...(taskId ? { taskId } : {}) }),
    });
    if (!response.ok) {
      return { error: `R2 persist failed: ${response.status}` };
    }
    return persistImageToR2ResponseSchema.parse(await response.json());
  } catch (err) {
    return { error: `R2 persist failed: ${String(err)}` };
  }
};

export const updateMessageContent = async (messageId: string, content: string): Promise<void> => {
  const response = await apiFetch(`/api/messages/${encodeURIComponent(messageId)}/content`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  ensureOk(response, "update message content failed");
};

// ── キャラクター ──────────────────────────────────────────────────────────

const characterSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  nameReading: z.string().nullable().optional(),
  avatar: z.string().nullable(),
  slug: z.string().nullable().optional(),
  isOfficial: z.boolean().nullable().optional(),
  gender: z.enum(["male", "female", "other"]).nullable().optional(),
  systemPrompt: z.string(),
  greeting: z.string(),
  tags: z.array(z.string()),
  userPersonaName: z.string().nullable().optional(),
  userPersonaGender: z.enum(["male", "female", "other"]).nullable().optional(),
  userPersonaPersonality: z.string().nullable().optional(),
  createdAt: z.number(),
  visualMeta: visualMetaSchema.nullable().optional(),
});

const listCharactersSchema = z.object({
  characters: z.array(characterSchema),
});
const CHARACTER_LIST_TIMEOUT_MS = 15_000;

const createCharacterResponseSchema = z.object({
  character: characterSchema,
});

// PUT /api/characters/:id は buildCharacterUpdatesWithSlug の戻り値（DBカラムのpartial）を返す。
// サーバ側でsanitizeUserDisplayName等を通した後の正規化済みの値。
// 更新フィールドが無い場合は { ok: true } だけ返ることもあるため updates は optional とする。
const updateCharacterResponseSchema = z.object({
  ok: z.boolean(),
  updates: z
    .object({
      name: z.string(),
      avatar: z.string().nullable(),
      visualPrompt: z.string().nullable(),
      systemPrompt: z.string(),
      greeting: z.string(),
      tags: z.array(z.string()),
      gender: z.enum(["male", "female", "other"]).nullable(),
      userPersonaName: z.string().nullable(),
      userPersonaGender: z.enum(["male", "female", "other"]).nullable(),
      userPersonaPersonality: z.string().nullable(),
      loraModel: z.string().nullable(),
      loraWeight: z.number().nullable(),
      loraTriggerPrompt: z.string().nullable(),
      slug: z.string(),
    })
    .partial()
    .optional(),
});

export type Character = z.infer<typeof characterSchema>;

export type CharacterPersonaInput = {
  name?: string | null;
  gender?: "male" | "female" | "other" | null;
  personality?: string | null;
};

export type CharacterInput = {
  name: string;
  avatar?: string;
  gender?: "male" | "female" | "other" | null;
  systemPrompt: string;
  greeting: string;
  tags: string[];
  userPersona?: CharacterPersonaInput;
  // /api/image 生成時の seed。固定すると profile↔chat の見た目が決定論的に一致する
  seed?: number;
  // name/外見/tags から導出した画像生成用プロンプト。作成時に保存する
  visualPrompt?: string;
  // 作成と同時に character_visual を作る。根拠が無い時は送らない（既定値の行を作らせない）
  visualMeta?: VisualMeta | null;
};

export const listCharacters = async (): Promise<Character[]> => {
  let response: Response;
  try {
    response = await apiFetch("/api/characters", {
      signal: AbortSignal.timeout(CHARACTER_LIST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new ApiResponseError("list characters timed out", 408);
    }
    throw new ApiResponseError("list characters network failed", 0);
  }
  if (!response.ok) {
    throw new ApiResponseError("list characters failed", response.status);
  }
  return listCharactersSchema.parse(await response.json()).characters;
};

export const createCharacter = async (input: CharacterInput): Promise<Character> => {
  const response = await apiFetch("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  ensureOk(response, "create character failed");
  return createCharacterResponseSchema.parse(await response.json()).character;
};

// #1224/#1228: userPersonaNameはサーバ側でsanitizeUserDisplayNameを通り正規化されうる。
// 呼び出し側は生の入力ではなくこの戻り値でキャッシュを更新し、表示値とD1の実値の
// 乖離を防ぐ（敵対レビュー #1236 指摘・6巡目）。
export const updateCharacter = async (
  id: string,
  input: CharacterInput,
): Promise<Partial<Character>> => {
  const response = await apiFetch(`/api/characters/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  ensureOk(response, "update character failed");
  const data = updateCharacterResponseSchema.parse(await response.json());
  return data.updates ?? {};
};

export const deleteCharacter = async (id: string): Promise<void> => {
  const response = await apiFetch(`/api/characters/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  ensureOk(response, "delete character failed");
};

export const updateCharacterVisualMeta = async (
  characterId: string,
  meta: VisualMeta,
): Promise<void> => {
  const response = await apiFetch(
    `/api/characters/${encodeURIComponent(characterId)}/visual-meta`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    },
  );
  ensureOk(response, "update character visual meta failed");
};

// ── グループチャット ──────────────────────────────────────────────────────

const groupCharacterSchema = characterSchema.pick({
  id: true,
  name: true,
  avatar: true,
  systemPrompt: true,
  greeting: true,
  tags: true,
});

const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  characterIds: z.array(z.string()),
  scenario: z.string().nullable(),
  createdAt: z.number(),
  characters: z.array(groupCharacterSchema).optional(),
});

const groupMessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  role: z.enum(["user", "assistant"]),
  speakerCharacterId: z.string().nullable(),
  content: z.string(),
  imageUrl: z.string().nullable().optional(),
  imageKey: z.string().nullable().optional(),
  createdAt: z.number(),
});

const listGroupsSchema = z.object({
  groups: z.array(groupSchema),
});

const groupResponseSchema = z.object({
  group: groupSchema.extend({ characters: z.array(groupCharacterSchema) }),
});

const listGroupMessagesSchema = z.object({
  messages: z.array(groupMessageSchema),
  nextCursor: z.number().nullable().optional(),
});

export type GroupCharacter = z.infer<typeof groupCharacterSchema>;
export type ChatGroup = z.infer<typeof groupSchema>;
export type GroupMessageRecord = z.infer<typeof groupMessageSchema>;

export const createGroup = async (input: {
  name: string;
  characterIds: string[];
  scenario?: string;
}): Promise<ChatGroup> => {
  const response = await apiFetch("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  ensureOk(response, "create group failed");
  return groupResponseSchema.parse(await response.json()).group;
};

export const listGroups = async (): Promise<ChatGroup[]> => {
  const response = await apiFetch("/api/groups");
  ensureOk(response, "list groups failed");
  return listGroupsSchema.parse(await response.json()).groups;
};

export const getGroup = async (groupId: string): Promise<ChatGroup> => {
  const response = await apiFetch(`/api/groups/${encodeURIComponent(groupId)}`);
  ensureOk(response, "get group failed");
  return groupResponseSchema.parse(await response.json()).group;
};

export const deleteGroup = async (groupId: string): Promise<void> => {
  const response = await apiFetch(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: "DELETE",
  });
  ensureOk(response, "delete group failed");
};

export const listGroupMessages = async (
  groupId: string,
  cursor?: number,
): Promise<{ messages: GroupMessageRecord[]; nextCursor: number | null }> => {
  const params = new URLSearchParams();
  if (cursor !== undefined) params.set("cursor", String(cursor));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`/api/groups/${encodeURIComponent(groupId)}/messages${suffix}`);
  ensureOk(response, "list group messages failed");
  const parsed = listGroupMessagesSchema.parse(await response.json());
  return {
    messages: parsed.messages,
    nextCursor: parsed.nextCursor ?? null,
  };
};

export const sendGroupMessage = async (
  groupId: string,
  input: { content: string; imageHint?: string },
  onChunk: (text: string) => void,
  onDone: (result: ChatStreamResult) => void,
  onError: (error: string) => void,
): Promise<void> => {
  try {
    const response = await apiFetch(`/api/groups/${encodeURIComponent(groupId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok || !response.body) {
      onError(await classifyApiResponseError(response));
      return;
    }

    const warningLevel = response.headers.get("x-quality-warning") === "1";
    let accumulated = "";
    await processStream(
      response.body,
      (chunk) => {
        accumulated += chunk;
        onChunk(chunk);
      },
      (result) =>
        onDone({ content: accumulated, warningLevel, usedMemoryIds: result.usedMemoryIds }),
      onError,
    );
  } catch (error) {
    logger.error("sendGroupMessage failed", error);
    onError(classifyApiError(error));
  }
};
