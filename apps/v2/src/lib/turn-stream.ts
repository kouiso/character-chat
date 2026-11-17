import {
  ChatConnectionError,
  attachChatTurn,
  connectChatTurn,
  parseEventBlock,
} from "./chat-session";

import type { PendingTurn } from "./chat-session";
import type { ChatSseEvent } from "./sse-events";

// 待ち続けた合計時間の天井（板 TalkWaiting-4「あきらめる時」）。ここまで返事が来んと「届かなかった」へ。
const GAVE_UP_MS = 300_000;
// 1バイトも来んままの見切り時間。ping が約15秒ごとに来るので、その3回分を超えたら繋ぎ直す。
const BYTE_TIMEOUT_MS = 45_000;
// 繋ぎ直しの待ち時間（指数・上限つき）。
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 15_000;

// 終わりの印。done・terminal の error・stopped が来たら繋ぎ直さん。
const isTerminal = (event: ChatSseEvent): boolean =>
  event.type === "done" ||
  event.type === "stopped" ||
  (event.type === "error" && event.terminal === true);

export type TurnStreamSignal =
  // 部屋から届いた出来事。id は出来事番号（Last-Event-ID に使う）。
  | { type: "event"; id: number; event: ChatSseEvent }
  // 接続が切れて待ち直し中。attempt は連続の失敗回数。
  | { type: "reconnecting"; attempt: number }
  // 300秒待っても終わりが見えんかった。画面は「返事が届かなかった」へ。
  | { type: "gave_up" };

export type FollowTurnOptions = {
  // 開き直した保留など、受付が部屋に在ると分かっとる時は真（POST を飛ばして GET でつなぐ）。
  attach: boolean;
  // 「もう一度」の作り直し（失敗の出来事を受けた受付だけ true。新しい受付番号は作らん）。
  retry?: boolean;
  // 既に読んだ出来事番号。開き直しの続きから配らせる。
  after?: number;
  signal: AbortSignal;
};

const wait = (ms: number, signal: AbortSignal): Promise<"elapsed" | "aborted" | "wake"> =>
  new Promise((resolve) => {
    // 待ちに入る直前に切れとっても、listener は発火せんのでここで見る。
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    let done = false;
    const finish = (result: "elapsed" | "aborted" | "wake") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      resolve(result);
    };
    const timer = setTimeout(() => finish("elapsed"), ms);
    const onAbort = () => finish("aborted");
    // 回線復帰や画面復帰で早めに繋ぎ直す
    const onWake = () => {
      if (document.visibilityState === "visible" || navigator.onLine) finish("wake");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
  });

// 1 回の read を 45 秒のタイマーと競争させる。区切りが来んまま止まる接続も打ち切れる。
type ReadResult = { value?: Uint8Array; done?: boolean; timedOut?: boolean };

const timedRead = (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadResult> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<ReadResult>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), BYTE_TIMEOUT_MS);
  });
  return Promise.race([
    reader.read().then((chunk) => ({ value: chunk.value, done: chunk.done }) satisfies ReadResult),
    timeout,
  ]).finally(() => clearTimeout(timer));
};

const isConnectionError = (cause: unknown): boolean => cause instanceof ChatConnectionError;

const backoffMs = (attempt: number): number =>
  Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));

type ReadOutcome = "eof" | "timeout" | "terminal" | "aborted";

// バッファの区切りを読み出す。読みきれんかった残りは rest へ戻す。
const splitBlocks = (
  buffer: string,
): { items: { id: number; event: ChatSseEvent }[]; rest: string } => {
  const blocks = buffer.split("\n\n");
  const items = blocks
    .slice(0, -1)
    .map(parseEventBlock)
    .filter((item) => item !== null);
  return { items, rest: blocks.at(-1) ?? "" };
};

// 読み出した出来事を配る。終わりの印が来たら sink.outcome を立てて打ち切る。
const emitItems = function* (
  items: { id: number; event: ChatSseEvent }[],
  sink: { outcome: ReadOutcome; lastId: number },
): Generator<TurnStreamSignal> {
  for (const item of items) {
    sink.lastId = Math.max(sink.lastId, item.id);
    yield { type: "event", id: item.id, event: item.event };
    if (isTerminal(item.event)) {
      sink.outcome = "terminal";
      return;
    }
  }
};

// 1 回の接続で出来事を最後まで読む。終わりの印・45 秒バイト無し・正常終了で閉じ、
// 閉じた理由と最後の出来事番号は sink へ書く（async generator は値を返せんので）。
const readLoop = async function* (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  sink: { outcome: ReadOutcome; lastId: number },
): AsyncGenerator<TurnStreamSignal> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const raced = await timedRead(reader);
      if (raced.timedOut) {
        sink.outcome = "timeout";
        return;
      }
      if (raced.done) return;
      if (signal.aborted) {
        sink.outcome = "aborted";
        return;
      }
      buffer += decoder.decode(raced.value, { stream: true });
      const split = splitBlocks(buffer);
      buffer = split.rest;
      yield* emitItems(split.items, sink);
      if (sink.outcome === "terminal") return;
    }
  } catch (cause) {
    // 受付後に流れの途中で切れた読み出し（ブラウザは TypeError を投げる）も「続きから
    // つなぎ直す」へ回す。ここで投げ直すと、受理済みの送信が「送れなかった」枠へ落ちる。
    if (!(cause instanceof TypeError) && !isConnectionError(cause)) throw cause;
    sink.outcome = "timeout";
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

const openConnection = (
  pending: PendingTurn,
  attach: boolean,
  retry: boolean,
  after: number,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> =>
  attach
    ? attachChatTurn(pending.characterId, pending.conversationId, pending.requestId, after, signal)
    : connectChatTurn(pending, signal, retry, after);

// 受付を追いかける流れ。POST か GET でつなぎ、切れたら番号の続きから繋ぎ直す。
// 部屋側の配信期限（180秒）で正常に切れても、終わりの印が来てへん限りつなぎ直す。
export async function* followTurn(
  pending: PendingTurn,
  options: FollowTurnOptions,
): AsyncGenerator<TurnStreamSignal> {
  const { signal } = options;
  let attach = options.attach;
  let lastId = options.after ?? 0;
  let attempt = 0;
  const deadline = Date.now() + GAVE_UP_MS;

  // 繋ぎ直しの合図を出して待つ。中断されたら false（=呼び元は return する）。
  const reconnect = async function* (): AsyncGenerator<TurnStreamSignal, boolean> {
    attempt += 1;
    yield { type: "reconnecting", attempt };
    return (await wait(backoffMs(attempt), signal)) !== "aborted";
  };

  // 1 回つなぐ。受付済みの接続が通信切れで落ちた時だけ null を返す（繋ぎ直しへ）。
  // 確定的な拒否・409 busy・受付前の POST 失敗は例外のまま呼び元へ返す。
  const connect = async (): Promise<ReadableStream<Uint8Array> | null> => {
    try {
      const body = await openConnection(pending, attach, options.retry === true, lastId, signal);
      // HTTP 200 までは届いた。ここから先の切れは「受付の続き」として GET でつなぐ。
      attach = true;
      attempt = 0;
      return body;
    } catch (cause) {
      if (isConnectionError(cause) && attach) return null;
      throw cause;
    }
  };

  for (;;) {
    if (signal.aborted) return;
    if (Date.now() >= deadline) {
      yield { type: "gave_up" };
      return;
    }
    const body = await connect();
    if (body === null) {
      if (!(yield* reconnect())) return;
      continue;
    }
    const sink: { outcome: ReadOutcome; lastId: number } = { outcome: "eof", lastId };
    yield* readLoop(body, signal, sink);
    lastId = sink.lastId;
    if (sink.outcome === "terminal" || signal.aborted) return;
    // eof・timeout・通信切れは全部「続きからつなぎ直す」。
    if (!(yield* reconnect())) return;
  }
}
