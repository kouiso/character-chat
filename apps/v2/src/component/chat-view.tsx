import { useCallback, useEffect, useRef, useState } from "react";

import {
  ChatHistoryError,
  ChatTurnError,
  connectChatTurn,
  loadChatHistory,
  readChatEvents,
  readChatSession,
  writeChatSession,
} from "../lib/chat-session";

import { ChatMessage } from "./chat-message";
import { ChatMessageLog } from "./chat-message-log";
import { ScheduledReply } from "./scheduled-reply";

import type { ChatBubble, PendingTurn } from "../lib/chat-session";
import type { ChatSseEvent } from "../lib/sse-events";

export type ChatViewProps = { characterId: string; characterName: string };

const withoutTyping = (history: ChatBubble[]): ChatBubble[] =>
  history.filter((bubble) => !(bubble.role === "assistant" && bubble.pending && !bubble.delivery));

const withPending = (
  history: ChatBubble[],
  nextTurn: number,
  pending: PendingTurn,
): ChatBubble[] => {
  if (nextTurn > pending.baseTurn) return history;
  const previous = withoutTyping(history);
  if (!previous.some((bubble) => bubble.role === "user" && bubble.turn === pending.baseTurn))
    previous.push({ role: "user", text: pending.text, turn: pending.baseTurn });
  if (
    pending.terminalError === undefined &&
    !previous.some((bubble) => bubble.role === "assistant" && bubble.turn === pending.baseTurn)
  )
    previous.push({ role: "assistant", text: "", pending: true, turn: pending.baseTurn });
  return previous;
};

const withDelivery = (
  history: ChatBubble[],
  event: Extract<ChatSseEvent, { type: "delivery" }>,
): ChatBubble[] => {
  const next = [...history];
  const index = next.findIndex(
    (bubble) => bubble.role === "assistant" && bubble.turn === event.turn,
  );
  const bubble: ChatBubble = { role: "assistant", text: "", turn: event.turn, delivery: event };
  if (index < 0) next.push(bubble);
  else next[index] = bubble;
  return next;
};

const persistPending = (turn: PendingTurn): void =>
  writeChatSession(turn.characterId, {
    version: 1,
    conversationId: turn.conversationId,
    pending: turn,
  });

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "返信を確認できませんでした。";

const restartHistory = async (characterId: string, conversationId: string, signal: AbortSignal) => {
  try {
    return await loadChatHistory(characterId, conversationId, signal);
  } catch (cause) {
    if (cause instanceof ChatHistoryError && cause.status === 404) return null;
    throw cause;
  }
};

const CharacterChatView = ({ characterId, characterName }: ChatViewProps) => {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const conversationId = useRef<string | null>(null);
  const nextTurn = useRef(1);
  const submitting = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const replaceController = () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    return abort;
  };

  const applyEvent = useCallback((event: ChatSseEvent, turn: PendingTurn): boolean => {
    if (event.type === "error") throw new ChatTurnError(event);
    if (event.type !== "delivery" && event.type !== "done") return false;
    if (event.conversationId !== turn.conversationId || event.turn !== turn.baseTurn)
      throw new ChatTurnError({
        type: "error",
        message: "返信の会話を確認できませんでした。",
        retryable: false,
        code: "recovery_conflict",
      });
    // 保存前のtoken/chunkは表示せず、確定した配送とその予定時刻だけを使う。
    if (event.type === "delivery") {
      setBubbles((previous) => withDelivery(previous, event));
      return false;
    }
    return true;
  }, []);

  const completeTurn = useCallback(async (turn: PendingTurn, signal: AbortSignal) => {
    const history = await loadChatHistory(turn.characterId, turn.conversationId, signal);
    signal.throwIfAborted();
    if (history.nextTurn <= turn.baseTurn)
      throw new Error("返信の保存を確認できませんでした。再接続してください。");
    writeChatSession(turn.characterId, {
      version: 1,
      conversationId: turn.conversationId,
      pending: null,
    });
    nextTurn.current = history.nextTurn;
    setBubbles(history.bubbles);
    setPending(null);
  }, []);

  const showFailure = useCallback((cause: unknown, turn: PendingTurn) => {
    const terminal = cause instanceof ChatTurnError && !cause.retryable;
    const failed = terminal ? { ...turn, terminalError: failureMessage(cause) } : turn;
    setPending(failed);
    setError(failureMessage(cause));
    if (terminal) {
      try {
        persistPending(failed);
      } catch {
        setError(`${failureMessage(cause)} この端末への状態保存にも失敗しました。`);
      }
    }
  }, []);

  const consume = useCallback(
    async (turn: PendingTurn, signal: AbortSignal, retry = false) => {
      let current = retry ? { ...turn, lastEventId: 0 } : turn;
      setBusy(true);
      setError(null);
      setBubbles((previous) => withPending(previous, nextTurn.current, current));
      try {
        if (retry) persistPending(current);
        const stream = await connectChatTurn(current, signal, retry, (lastEventId) => {
          current = { ...current, lastEventId };
          persistPending(current);
          if (!signal.aborted) setPending(current);
        });
        let completed = false;
        for await (const event of readChatEvents(stream)) {
          signal.throwIfAborted();
          completed = applyEvent(event, current) || completed;
        }
        if (!completed) throw new Error("接続が切れました。再接続してください。");
        await completeTurn(current, signal);
      } catch (cause) {
        if (!signal.aborted) showFailure(cause, current);
      } finally {
        if (!signal.aborted) {
          setBusy(false);
          setBubbles(withoutTyping);
        }
      }
    },
    [applyEvent, completeTurn, showFailure],
  );

  const restore = useCallback(
    async (signal: AbortSignal, resume = true) => {
      const saved = readChatSession(characterId);
      conversationId.current = saved.conversationId;
      setPending(saved.pending);
      setError(null);
      if (!saved.conversationId) return;
      setBusy(true);
      try {
        const history = await loadChatHistory(characterId, saved.conversationId, signal);
        signal.throwIfAborted();
        nextTurn.current = history.nextTurn;
        setBubbles(
          saved.pending
            ? withPending(history.bubbles, history.nextTurn, saved.pending)
            : history.bubbles,
        );
        if (!saved.pending) return;
        if (saved.pending.terminalError !== undefined) setError(saved.pending.terminalError);
        else if (resume) await consume(saved.pending, signal);
        else setError("返信の状態を再接続して確認できます。");
      } catch {
        if (!signal.aborted) setError("会話を再開できませんでした。履歴を読み直してください。");
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    },
    [characterId, consume],
  );

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    void restore(abort.signal);
    return () => controller.current?.abort();
  }, [restore]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || pending || submitting.current) return;
    if (text.length > 4000) {
      setError("メッセージは4000文字以内で入力してください。");
      return;
    }
    submitting.current = true;
    const turn: PendingTurn = {
      characterId,
      conversationId: conversationId.current ?? crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      text,
      baseTurn: nextTurn.current,
    };
    try {
      persistPending(turn);
    } catch {
      submitting.current = false;
      setError("この端末に送信内容を保存できません。入力は保持されています。");
      return;
    }
    conversationId.current = turn.conversationId;
    setPending(turn);
    setInput("");
    const abort = replaceController();
    try {
      await consume(turn, abort.signal);
    } finally {
      submitting.current = false;
    }
  };

  const retry = () => {
    if (!pending || busy || pending.terminalError !== undefined) return;
    const abort = replaceController();
    void consume(pending, abort.signal, true);
  };

  const retryHistory = () => {
    if (busy) return;
    const abort = replaceController();
    void restore(abort.signal, false);
  };

  const acceptRestart = (
    failed: PendingTurn,
    history: Awaited<ReturnType<typeof restartHistory>>,
  ) => {
    const id = history ? failed.conversationId : null;
    writeChatSession(characterId, { version: 1, conversationId: id, pending: null });
    conversationId.current = id;
    nextTurn.current = history?.nextTurn ?? 1;
    setBubbles(history?.bubbles ?? []);
    setPending(null);
    setInput((draft) => draft || failed.text);
    setError(null);
  };

  const restartInput = async () => {
    if (!pending || busy) return;
    const failed = pending;
    const abort = replaceController();
    setBusy(true);
    try {
      const history = await restartHistory(characterId, failed.conversationId, abort.signal);
      abort.signal.throwIfAborted();
      acceptRestart(failed, history);
    } catch {
      if (!abort.signal.aborted)
        setError("入力を再開できませんでした。履歴を確認してからやり直してください。");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };

  return (
    <div className="v2-chat">
      <div className="v2-chat-header">{characterName}</div>
      <ChatMessageLog busy={busy}>
        {bubbles.map((bubble, index) =>
          bubble.delivery ? (
            <ScheduledReply
              key={`${bubble.delivery.conversationId}:${bubble.delivery.turn}`}
              snapshot={bubble.delivery}
              characterName={characterName}
            />
          ) : (
            <div
              key={index}
              className={`v2-bubble ${bubble.role} ${bubble.pending ? "pending" : "v2-message-turn"}`}
              role={bubble.pending ? "status" : undefined}
            >
              {bubble.pending ? (
                "入力中"
              ) : (
                <ChatMessage role={bubble.role} text={bubble.text} characterName={characterName} />
              )}
            </div>
          ),
        )}
      </ChatMessageLog>
      {error && (
        <div className="v2-error" role="alert">
          {error}
          {pending && pending.terminalError === undefined && (
            <button type="button" onClick={retry} disabled={busy}>
              再接続・再試行
            </button>
          )}
          {pending && (
            <div>
              <p>この送信は再送せず、保存済みの履歴から入力をやり直します。</p>
              <button
                type="button"
                onClick={() => {
                  void restartInput();
                }}
                disabled={busy}
              >
                入力をやり直す
              </button>
            </div>
          )}
          <button type="button" onClick={retryHistory} disabled={busy}>
            履歴を読み直す
          </button>
          <a href="/">会話一覧へ戻る</a>
        </div>
      )}
      <form
        className="v2-chat-form"
        onSubmit={(event) => {
          void send(event);
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="メッセージを入力"
          aria-label="メッセージ"
          maxLength={4000}
          disabled={busy || pending !== null}
        />
        <button type="submit" disabled={busy || pending !== null || input.trim().length === 0}>
          送信
        </button>
      </form>
    </div>
  );
};

// キャラクターを替えた時、旧会話の本文・識別子・送信中状態を新画面へ持ち越さん。
export const ChatView = (props: ChatViewProps) => (
  <CharacterChatView key={props.characterId} {...props} />
);
