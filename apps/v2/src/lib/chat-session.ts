import { z } from "zod";

import { parseSseEvent } from "./sse-events";

import type { ChatSseEvent } from "./sse-events";

const pendingSchema = z.object({
  requestId: z.string(),
  conversationId: z.string(),
  characterId: z.string(),
  text: z.string(),
  baseTurn: z.number().int().positive(),
  // 受理の印（RIT-87）。HTTP 200 を受けて部屋の受付が確実に在る時だけ真。
  // 無い（届く前に切れたかもしれん）時は、開き直した時に GET /turn で確かめてからつなぐ。
  accepted: z.boolean().optional(),
});
const sessionSchema = z.object({
  version: z.literal(1),
  conversationId: z.string().nullable(),
  pending: pendingSchema.nullable(),
});
const storedTurnSchema = z.object({
  turn: z.number().int().positive(),
  user: z.string().nullable(),
  answered: z.boolean(),
});
const historySchema = z.object({
  history: z.array(
    z.object({
      id: z.string(),
      turn: z.number().int(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      imageUrl: z.string().optional(),
      // 動画メッセージ（RIT-190）。imageUrl の実体が mp4 なら "video"。
      mediaKind: z.enum(["image", "video"]).optional(),
    }),
  ),
  turn: z.number().int(),
  storedTurn: storedTurnSchema.nullable().optional(),
});
const rejectionSchema = z.object({ code: z.string().optional() });
export type PendingTurn = z.infer<typeof pendingSchema>;
export type ChatSession = z.infer<typeof sessionSchema>;
export type ChatBubble = {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  imageUrl?: string;
  mediaKind?: "image" | "video";
  // RIT-202: 枝操作に必要な永続行の id とターン番号（ストリーム中の仮バブルは無し）。
  id?: string;
  turn?: number;
};
export type StoredTurn = z.infer<typeof storedTurnSchema>;

// 送り直しても同じ結果になる拒否（内容の不備・会話やキャラが無い・受付番号の衝突）。
// 再接続を勧めても直らんので、画面は入力に戻す道を出す。
export class ChatRequestRejectedError extends Error {
  constructor() {
    super("この内容では送信できませんでした。入力に戻して確認してください。");
    this.name = "ChatRequestRejectedError";
  }
}

const isDefinitiveRejection = async (response: Response): Promise<boolean> => {
  if ([400, 404, 422].includes(response.status)) return true;
  if (response.status !== 409) return false;
  const body = rejectionSchema.safeParse(await response.json().catch(() => null));
  return body.success && body.data.code === "conflict";
};

// 使いすぎ止め（429）。理由文はサーバからのものをそのまま画面へ出す。
// 再試行で直らんので Rejected の仲間として扱い、「入力に戻す」の出口が出る。
export class ChatDailyLimitError extends ChatRequestRejectedError {
  constructor(message: string) {
    super();
    this.name = "ChatDailyLimitError";
    this.message = message;
  }
}

// 送信が割り当てられたターンに pending.text が残り、返信まで残っとる時だけ「送信は保存された」とみなす。
// サーバーが送信を知らん（null）なら、届いとらんので保存されてへん。
// 通信そのものが切れた（fetch や応答の読み出しが TypeError で落ちた）時だけに使う。
// 画面はブラウザの英語の文（「Failed to fetch」など）の代わりに、再接続を促すこの文を出す。
export class ChatConnectionError extends Error {
  constructor() {
    super("通信が切れました。再接続してください。");
    this.name = "ChatConnectionError";
  }
}

// fetch と応答の読み出しが投げる TypeError は通信の失敗。ここでだけ ChatConnectionError へ置き換え、
// 中断（AbortError）やそれ以外の例外はそのまま通す。
const throughNetwork = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof TypeError) throw new ChatConnectionError();
    throw cause;
  }
};

// 送信がまだ作成中で、戻すと返信が後から保存されて二重になる。
export class ChatTurnActiveError extends Error {
  constructor() {
    super("返信をまだ作成中です。再接続してください。");
    this.name = "ChatTurnActiveError";
  }
}

// 会話に別の受付が走っとる（409 busy）。active は部屋が教える進行中の受付。
// 画面は送信文を入力へ戻し、エラーの枠は出さん。
export type BusyActive = { requestId: string; kind: string; text: string; turn: number };
export class ChatRoomBusyError extends Error {
  readonly active: BusyActive | null;
  constructor(active: BusyActive | null) {
    super("この会話の返信を作成中です。");
    this.name = "ChatRoomBusyError";
    this.active = active;
  }
}

// 「止める」の結果。missing（受付が部屋に届いとらん）も画面側は stopped と同じに扱う。
export type StopOutcome = "stopped" | "truncated" | "saved" | "failed";
export type StopResult = { outcome: StopOutcome; turn: number | null };

// 進行中の受付の調べ（GET turn）。自分の受付が残っとるかを見る request と、
// 別の受付が走っとるかを見る active の 2 つを返す。
export type TurnStateRequest = {
  requestId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "stopped";
  turn: number;
  kind: string;
  failureCode?: string | null;
};
export type TurnState = { active: BusyActive | null; request: TurnStateRequest | null };

export const isPendingSaved = (
  pending: PendingTurn,
  stored: StoredTurn | null | undefined,
): boolean =>
  stored !== null && stored !== undefined && stored.user === pending.text && stored.answered;

// 保存済み会話を開き直せるので、保留はキャラ単位の1枠やなく会話ごとに持つ。
// キャラ単位の枠は「次に開く会話」だけを指し、旧形式で中に入っとる保留も読めるよう残す。
const activeKey = (characterId: string) => `v2-chat-session:${characterId}`;
const pendingKey = (characterId: string, conversationId: string) =>
  `v2-chat-pending:${characterId}:${conversationId}`;

const EMPTY_SESSION: ChatSession = { version: 1, conversationId: null, pending: null };

const parseStored = <T>(schema: z.ZodType<T>, raw: string | null): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(raw ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const readActive = (characterId: string): ChatSession =>
  parseStored(sessionSchema, localStorage.getItem(activeKey(characterId))) ?? EMPTY_SESSION;

const belongsTo = (
  pending: PendingTurn | null,
  characterId: string,
  conversationId: string,
): pending is PendingTurn =>
  pending !== null &&
  pending.characterId === characterId &&
  pending.conversationId === conversationId;

const readPending = (characterId: string, conversationId: string): PendingTurn | null => {
  const raw = localStorage.getItem(pendingKey(characterId, conversationId));
  if (raw !== null) {
    const stored = parseStored(pendingSchema, raw);
    return belongsTo(stored, characterId, conversationId) ? stored : null;
  }
  const legacy = readActive(characterId).pending;
  return belongsTo(legacy, characterId, conversationId) ? legacy : null;
};

export const readChatSession = (characterId: string, conversationId?: string): ChatSession => {
  if (typeof window === "undefined") return EMPTY_SESSION;
  try {
    const target = conversationId ?? readActive(characterId).conversationId;
    if (!target) return EMPTY_SESSION;
    return { version: 1, conversationId: target, pending: readPending(characterId, target) };
  } catch {
    return EMPTY_SESSION;
  }
};

export const writePendingTurn = (
  characterId: string,
  conversationId: string,
  pending: PendingTurn | null,
): void => {
  if (pending) {
    localStorage.setItem(pendingKey(characterId, conversationId), JSON.stringify(pending));
    return;
  }
  const active = readActive(characterId);
  // 旧形式の枠に残った同じ保留を消さんと、会話ごとの枠が空いた時に読み戻して再送してまう
  if (belongsTo(active.pending, characterId, conversationId)) {
    localStorage.setItem(activeKey(characterId), JSON.stringify({ ...active, pending: null }));
  }
  localStorage.removeItem(pendingKey(characterId, conversationId));
};

export const writeActiveConversation = (characterId: string, conversationId: string): void => {
  const active = readActive(characterId);
  const legacy = active.pending;
  // 旧形式の枠を上書きする前に、中の保留を会話ごとの枠へ移して失わんようにする
  if (
    legacy &&
    belongsTo(legacy, characterId, legacy.conversationId) &&
    localStorage.getItem(pendingKey(characterId, legacy.conversationId)) === null
  ) {
    localStorage.setItem(pendingKey(characterId, legacy.conversationId), JSON.stringify(legacy));
  }
  localStorage.setItem(
    activeKey(characterId),
    JSON.stringify({ version: 1, conversationId, pending: null } satisfies ChatSession),
  );
};

export const writeChatSession = (characterId: string, session: ChatSession): void => {
  if (!session.conversationId) return;
  writePendingTurn(characterId, session.conversationId, session.pending);
  writeActiveConversation(characterId, session.conversationId);
};

// 同じ会話を別のタブでも開いとると、会話ごとの保存枠を取り合う。自分の送信がまだ枠に残っとる時だけ
// 片付け、別のタブが後から入れた保留は残す。「次に開く会話」もここでは動かさん。
export const clearPendingTurn = (characterId: string, turn: PendingTurn): void => {
  if (readChatSession(characterId, turn.conversationId).pending?.requestId !== turn.requestId)
    return;
  writePendingTurn(characterId, turn.conversationId, null);
};

export const loadChatHistory = async (
  characterId: string,
  conversationId: string,
  signal: AbortSignal,
  requestId?: string,
): Promise<{ bubbles: ChatBubble[]; nextTurn: number; storedTurn?: StoredTurn | null }> => {
  const query = new URLSearchParams({ conversationId });
  if (requestId !== undefined) query.set("requestId", requestId);
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/history?${query}`, { signal }),
  );
  // 会話やキャラが無い・設定が壊れとる時は、何度読んでも同じ。送信と同じく確定的な拒否として返す。
  if (requestId !== undefined && response.status === 409) throw new ChatTurnActiveError();
  if (response.status === 404 || response.status === 422) throw new ChatRequestRejectedError();
  if (!response.ok) throw new Error("会話履歴を読み込めませんでした。再試行してください。");
  const history = historySchema.parse(await response.json());
  return {
    bubbles: history.history.map((item) => ({
      role: item.role,
      text: item.content,
      imageUrl: item.imageUrl,
      mediaKind: item.mediaKind,
      id: item.id,
      turn: item.turn,
    })),
    nextTurn: history.turn,
    storedTurn: history.storedTurn,
  };
};

// SSE の 1 区切り。`id:` は部屋の出来事番号（再接続時の Last-Event-ID にそのまま使う）。
export type SequencedChatEvent = { id: number; event: ChatSseEvent };

export const parseEventBlock = (block: string): SequencedChatEvent | null => {
  const lines = block.split("\n");
  const eventName = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = lines
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
  const id = Number(
    lines
      .find((line) => line.startsWith("id:"))
      ?.slice(3)
      .trim() ?? "0",
  );
  const event = eventName && data ? parseSseEvent(eventName, data) : null;
  return event ? { id, event } : null;
};

export const readChatEvents = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatSseEvent> {
  for await (const item of readSequencedChatEvents(body)) yield item.event;
};

export const readSequencedChatEvents = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SequencedChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await throughNetwork(() => reader.read());
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      yield* blocks.map(parseEventBlock).filter((item) => item !== null);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
};

// 画像生成の上書きパラメータ（RIT-183）。未指定キーはサーバ側でレシピ既定値へ倒れる。
// sourceMessageId+instruction は i2i 表情変更用（RIT-184）。参照は同一会話の画像のみ。
export type ChatImageParams = {
  cfg?: number;
  seed?: number;
  negativePrompt?: string;
  width?: number;
  height?: number;
  strength?: number;
  sourceMessageId?: string;
  instruction?: string;
};

// 画像生成ボタン。失敗理由はサーバの message をそのまま画面へ出す（RIT-182 の失敗可視）。
export const requestChatImage = async (
  characterId: string,
  conversationId: string,
  params: ChatImageParams | undefined,
  signal: AbortSignal,
): Promise<{ messageId: string; imageUrl: string }> => {
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({ conversationId, ...params }),
    }),
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "画像を生成できませんでした。再試行してください。");
  }
  return await response.json();
};

// 画像履歴ギャラリー（RIT-185）。一覧の正はサーバ側の v2_message なので、
// ここは受け取った並び（新しい順）をそのまま返すだけに留める。
const imageGallerySchema = z.object({
  images: z.array(
    z.object({
      messageId: z.string(),
      imageUrl: z.string(),
      generationId: z.string().nullable(),
      // 4コマ漫画の束（RIT-189）。同じ起動のコマは同じ groupId、並びは panelIndex。
      groupId: z.string().nullable(),
      panelIndex: z.number().int().nullable(),
      // 動画メディア（RIT-190）。mp4 キーを持つメッセージは "video"。
      mediaKind: z.enum(["image", "video"]),
      turn: z.number().int(),
      createdAt: z.number(),
    }),
  ),
});
export type ChatImageEntry = z.infer<typeof imageGallerySchema>["images"][number];

export const listChatImages = async (
  characterId: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<ChatImageEntry[]> => {
  const query = new URLSearchParams({ conversationId });
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/images?${query}`, { signal }),
  );
  if (!response.ok) throw new Error("画像履歴を読み込めませんでした。");
  return imageGallerySchema.parse(await response.json()).images;
};

// 4コマ漫画の生成（RIT-189）。コマごとの成否をそのまま返し、
// 全部落ちた時（502）は失敗メッセージを投げる。
const comicResultSchema = z.object({
  groupId: z.string(),
  panelCount: z.number().int(),
  panels: z.array(
    z.object({
      panelIndex: z.number().int(),
      ok: z.boolean(),
      messageId: z.string().optional(),
      imageUrl: z.string().optional(),
      generationId: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});
export type ChatComicResult = z.infer<typeof comicResultSchema>;

export const requestChatComic = async (
  characterId: string,
  conversationId: string,
  signal: AbortSignal,
  // 失敗コマだけの再生成（RIT-189）。束とコマ番号はセットで渡す。
  retry?: { groupId: string; panelIndex: number },
): Promise<ChatComicResult> => {
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/comic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({ conversationId, ...retry }),
    }),
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "4コマを生成できませんでした。再試行してください。");
  }
  return comicResultSchema.parse(await response.json());
};

// 画像→動画変換（RIT-190）。POST は登録だけ済ませ、完了は GET で逐次ポーリングする。
const videoStartSchema = z.object({
  generationId: z.string(),
  status: z.string(),
});
const videoStatusSchema = z.object({
  generationId: z.string(),
  status: z.string(),
  messageId: z.string().optional(),
  videoUrl: z.string().optional(),
  failureReason: z.string().optional(),
});
export type ChatVideoStatus = z.infer<typeof videoStatusSchema>;

export const requestChatVideo = async (
  characterId: string,
  conversationId: string,
  messageId: string,
  signal: AbortSignal,
): Promise<{ generationId: string; status: string }> => {
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/video`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({ conversationId, messageId }),
    }),
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "動画の生成を始められませんでした。再試行してください。");
  }
  return videoStartSchema.parse(await response.json());
};

export const fetchChatVideoStatus = async (
  characterId: string,
  generationId: string,
  signal: AbortSignal,
): Promise<ChatVideoStatus> => {
  const query = new URLSearchParams({ generationId });
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/video?${query}`, { signal }),
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "動画の状態を読めませんでした。");
  }
  return videoStatusSchema.parse(await response.json());
};

// 消した画像は一覧・タイムラインの両方から消える（サーバがメッセージ行と R2 実体を消す）。
export const deleteChatImage = async (
  characterId: string,
  conversationId: string,
  messageId: string,
): Promise<void> => {
  const query = new URLSearchParams({ conversationId, messageId });
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/images?${query}`, {
      method: "DELETE",
    }),
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "画像を消せませんでした。再試行してください。");
  }
};

// 409 の本文を確かめる。conflict は確定的な拒否、busy は別の受付が走っとる合図。
const readConflictBody = async (
  response: Response,
): Promise<{ code?: string; active?: BusyActive | null }> => {
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    active?: BusyActive;
  } | null;
  return { code: body?.code, active: body?.active ?? null };
};

// POST の返事を失敗の種類へ写す。通った時は何もせず返る。
const throwForTurnResponse = async (response: Response): Promise<void> => {
  if (response.ok) return;
  if (response.status === 409) {
    const body = await readConflictBody(response);
    if (body.code === "busy") throw new ChatRoomBusyError(body.active ?? null);
    if (body.code === "conflict") throw new ChatRequestRejectedError();
  }
  if (await isDefinitiveRejection(response)) throw new ChatRequestRejectedError();
  if (response.status === 429) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ChatDailyLimitError(
      body?.message ?? "今日の会話回数の上限に達しました。送信文は入力欄に戻します。",
    );
  }
  throw new Error("返信を受け取れませんでした。再接続してください。");
};

export const connectChatTurn = async (
  pending: PendingTurn,
  signal: AbortSignal,
  retry = false,
  after = 0,
): Promise<ReadableStream<Uint8Array>> => {
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(pending.characterId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(after > 0 ? { "last-event-id": String(after) } : {}),
      },
      signal,
      body: JSON.stringify({
        conversationId: pending.conversationId,
        requestId: pending.requestId,
        text: pending.text,
        retry,
      }),
    }),
  );
  await throwForTurnResponse(response);
  if (!response.body) throw new Error("返信を受け取れませんでした。再接続してください。");
  return response.body;
};

// 部屋に控えた出来事を続きから配る口（GET /api/chat/:id/events）。
// 404 は受付が部屋に無い（届く前に取り下げ・止めた）。画面は POST の送り直しへ戻る。
export const attachChatTurn = async (
  characterId: string,
  conversationId: string,
  requestId: string,
  after: number,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> => {
  const query = new URLSearchParams({ conversationId, requestId });
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/events?${query}`, {
      headers: after > 0 ? { "last-event-id": String(after) } : {},
      signal,
    }),
  );
  if (response.status === 404) throw new ChatRequestRejectedError();
  if (response.status === 422) throw new ChatRequestRejectedError();
  if (!response.ok || !response.body)
    throw new Error("返信を受け取れませんでした。再接続してください。");
  return response.body;
};

// 進行中の受付の調べ（GET /api/chat/:id/turn）。開き直しと取り下げの 409 の後に使う。
export const readChatTurnState = async (
  characterId: string,
  conversationId: string,
  signal: AbortSignal,
  requestId?: string,
): Promise<TurnState> => {
  const query = new URLSearchParams({ conversationId });
  if (requestId !== undefined) query.set("requestId", requestId);
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/turn?${query}`, { signal }),
  );
  if (response.status === 404 || response.status === 422) throw new ChatRequestRejectedError();
  if (!response.ok) throw new Error("送信の状態を読めませんでした。再試行してください。");
  const body = z
    .object({
      active: z
        .object({
          requestId: z.string(),
          kind: z.string(),
          text: z.string(),
          turn: z.number().int(),
          status: z.string().optional(),
          attempts: z.number().int().optional(),
          startedAt: z.number().optional(),
        })
        .nullable(),
      request: z
        .object({
          requestId: z.string(),
          status: z.enum(["queued", "running", "succeeded", "failed", "stopped"]),
          turn: z.number().int(),
          kind: z.string(),
          failureCode: z.string().nullable().optional(),
        })
        .nullable(),
    })
    .parse(await response.json());
  return body;
};

// 「入力に戻す」（POST /api/chat/:id/withdraw）。200 は履歴と保存済みの確かめ、
// 409 は作成中（つなぎ直す方へ）、404/422 は手元だけで戻す方へ。
export const withdrawChatTurn = async (
  characterId: string,
  conversationId: string,
  requestId: string,
  signal: AbortSignal,
): Promise<{ bubbles: ChatBubble[]; nextTurn: number; storedTurn: StoredTurn | null }> => {
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({ conversationId, requestId }),
    }),
  );
  if (response.status === 409) throw new ChatTurnActiveError();
  if (response.status === 404 || response.status === 422) throw new ChatRequestRejectedError();
  if (!response.ok) throw new Error("入力を戻せませんでした。再試行してください。");
  const body = historySchema.parse(await response.json());
  return {
    bubbles: body.history.map((item) => ({
      role: item.role,
      text: item.content,
      imageUrl: item.imageUrl,
      mediaKind: item.mediaKind,
      id: item.id,
      turn: item.turn,
    })),
    nextTurn: body.turn,
    storedTurn: body.storedTurn ?? null,
  };
};

// 「止める」（POST /api/chat/:id/stop）。shownSeq は画面に出た最後の塊番号。
// 404 missing は画面側では stopped と同じに扱う（受付が届く前に印だけ書いた状態）。
export const stopChatTurn = async (
  characterId: string,
  conversationId: string,
  requestId: string,
  shownSeq: number | null,
  signal: AbortSignal,
): Promise<StopResult> => {
  const response = await throughNetwork(() =>
    fetch(`/api/chat/${encodeURIComponent(characterId)}/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({ conversationId, requestId, shownSeq }),
    }),
  );
  if (response.status === 404) return { outcome: "stopped", turn: null };
  if (response.status === 422) throw new ChatRequestRejectedError();
  if (!response.ok) throw new Error("返信を止められませんでした。再試行してください。");
  return z
    .object({
      outcome: z.enum(["stopped", "truncated", "saved", "failed"]),
      turn: z.number().int().nullable(),
    })
    .parse(await response.json());
};
