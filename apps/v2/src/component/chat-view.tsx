import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";
import {
  ChatRequestRejectedError,
  clearPendingTurn,
  connectChatTurn,
  isPendingSaved,
  loadChatHistory,
  readChatEvents,
  readChatSession,
  writeChatSession,
  type ChatBubble,
  type PendingTurn,
} from "../lib/chat-session";

import { ChatImage } from "./chat-image";
import { ChatMessage } from "./chat-message";

import type { ChatSseEvent } from "../lib/sse-events";

export type ChatViewProps = {
  characterId: string;
  characterName: string;
  initialConversationId?: string;
};

const withPending = (
  history: ChatBubble[],
  nextTurn: number,
  pending: PendingTurn,
): ChatBubble[] =>
  nextTurn > pending.baseTurn
    ? history
    : [
        ...history,
        { role: "user", text: pending.text },
        { role: "assistant", text: "", pending: true },
      ];

// withPending で足した「送信文 + 作成中の返信」の 2 つを外す。
const withoutPending = (history: ChatBubble[], pending: PendingTurn): ChatBubble[] => {
  const last = history.at(-1);
  const user = history.at(-2);
  return last?.role === "assistant" &&
    last.pending &&
    user?.role === "user" &&
    user.text === pending.text
    ? history.slice(0, -2)
    : history;
};

const updateAssistant = (history: ChatBubble[], text: string): ChatBubble[] =>
  history.map((bubble, index) =>
    index === history.length - 1 && bubble.role === "assistant"
      ? { ...bubble, text, pending: true }
      : bubble,
  );

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "返信を確認できませんでした。";

type ChatErrorEvent = Extract<ChatSseEvent, { type: "error" }>;

const consumeEvents = async (
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  onError: (event: ChatErrorEvent) => void,
): Promise<boolean> => {
  const chunks = new Map<number, string>();
  let completed = false;
  for await (const event of readChatEvents(stream)) {
    if (signal.aborted) return false;
    if (event.type === "chunk") {
      chunks.set(event.seq, event.text);
      onChunk(
        [...chunks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, value]) => value)
          .join("\n"),
      );
    }
    if (event.type === "error") {
      onError(event);
      throw new Error(event.message);
    }
    if (event.type === "done") completed = true;
  }
  return completed;
};

export const ChatView = ({ characterId, characterName, initialConversationId }: ChatViewProps) => {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [terminalFailure, setTerminalFailure] = useState(false);
  const conversationId = useRef<string | null>(null);
  const nextTurn = useRef(1);
  const controller = useRef<AbortController | null>(null);

  const consume = useCallback(async (turn: PendingTurn, signal: AbortSignal, retry = false) => {
    if (signal.aborted) return;
    setBusy(true);
    setError(null);
    setTerminalFailure(false);
    try {
      const stream = await connectChatTurn(turn, signal, retry);
      const completed = await consumeEvents(
        stream,
        signal,
        (text) => setBubbles((previous) => updateAssistant(previous, text)),
        (event) => setTerminalFailure(event.terminal === true),
      );
      if (!completed) throw new Error("接続が切れました。再接続してください。");
      // サーバーが完了を確かめた時点で保留を片付ける。履歴の読み直しで失敗しても、
      // 保存済みの送信を「入力に戻す」で戻して二重に送らせんため。
      clearPendingTurn(turn.characterId, turn);
      setPending(null);
      setBubbles((previous) => previous.map((bubble) => ({ ...bubble, pending: false })));
      nextTurn.current = turn.baseTurn + 1;
      const history = await loadChatHistory(turn.characterId, turn.conversationId, signal);
      if (signal.aborted) return;
      nextTurn.current = history.nextTurn;
      setBubbles(history.bubbles);
    } catch (cause) {
      if (signal.aborted) return;
      if (cause instanceof ChatRequestRejectedError) setTerminalFailure(true);
      setError(failureMessage(cause));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }, []);

  const restoreLocally = (turn: PendingTurn) => {
    clearPendingTurn(turn.characterId, turn);
    setBubbles((previous) => withoutPending(previous, turn));
    setInput(turn.text);
    setPending(null);
    setTerminalFailure(false);
    setError("会話を読み込めませんでした。送信内容は入力欄に戻しました。");
  };

  const recoverPending = () => {
    if (!pending || busy || !terminalFailure) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const history = await loadChatHistory(
          pending.characterId,
          pending.conversationId,
          abort.signal,
          pending.requestId,
        );
        if (abort.signal.aborted) return;
        // まだ作成中の送信を戻すと、返信が後から保存されて二重になる。再接続へ戻す。
        if (history.storedTurn?.active) {
          setTerminalFailure(false);
          setError("返信をまだ作成中です。再接続してください。");
          return;
        }
        // 番号が進んだだけでは、別の送信が会話を進めた場合と区別できん。そのターンの中身で決める。
        const restoreInput = !isPendingSaved(pending, history.storedTurn);
        clearPendingTurn(pending.characterId, pending);
        if (abort.signal.aborted) return;
        nextTurn.current = history.nextTurn;
        setBubbles(history.bubbles);
        setInput(restoreInput ? pending.text : "");
        setPending(null);
        setTerminalFailure(false);
        setError(null);
      } catch (cause) {
        if (abort.signal.aborted) return;
        if (cause instanceof ChatRequestRejectedError) {
          // 会話もキャラも読めんので、保存されたかは確かめようがない。送信文を手元へ戻して止まらんようにする。
          restoreLocally(pending);
          return;
        }
        setError("入力を戻せませんでした。再試行してください。");
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    })();
  };

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const restore = async () => {
      const saved = readChatSession(characterId, initialConversationId);
      conversationId.current = saved.conversationId;
      setPending(saved.pending);
      if (!saved.conversationId) return;
      setBusy(true);
      try {
        const history = await loadChatHistory(characterId, saved.conversationId, abort.signal);
        if (abort.signal.aborted) return;
        nextTurn.current = history.nextTurn;
        setBubbles(
          saved.pending
            ? withPending(history.bubbles, history.nextTurn, saved.pending)
            : history.bubbles,
        );
        if (saved.pending) await consume(saved.pending, abort.signal);
        else setBusy(false);
      } catch (cause) {
        if (!abort.signal.aborted) {
          // 確定的な拒否なら再試行しても直らんので、保留は「入力に戻す」で抜けられるようにする。
          if (saved.pending && cause instanceof ChatRequestRejectedError) setTerminalFailure(true);
          setError("会話を再開できませんでした。再試行してください。");
          setBusy(false);
        }
      }
    };
    void restore();
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [characterId, consume, initialConversationId]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || pending) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setError(`${MAX_MESSAGE_LENGTH}字以内で送信してください。入力は保持されています。`);
      return;
    }
    const turn: PendingTurn = {
      characterId,
      conversationId: conversationId.current ?? crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      text,
      baseTurn: nextTurn.current,
    };
    try {
      writeChatSession(characterId, {
        version: 1,
        conversationId: turn.conversationId,
        pending: turn,
      });
    } catch {
      setError("この端末に送信内容を保存できません。入力は保持されています。");
      return;
    }
    conversationId.current = turn.conversationId;
    setPending(turn);
    setInput("");
    setBubbles((previous) => withPending(previous, nextTurn.current, turn));
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    await consume(turn, abort.signal);
  };

  const retry = () => {
    if (!pending || busy) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    void consume(pending, abort.signal, true);
  };

  return (
    <div className="v2-chat">
      <div className="v2-chat-header">{characterName}</div>
      <div className="v2-chat-log" aria-live="polite">
        {bubbles.map((bubble, index) => (
          <div
            key={index}
            className={`v2-bubble ${bubble.role} ${bubble.pending ? "pending" : ""}`}
          >
            {bubble.imageUrl && <ChatImage src={bubble.imageUrl} />}
            {bubble.role === "assistant" && bubble.text ? (
              <ChatMessage content={bubble.text} />
            ) : (
              bubble.text || (bubble.pending ? "…" : "")
            )}
          </div>
        ))}
      </div>
      {error && (
        <div className="v2-error" role="alert">
          {error}
          {pending && (
            <button
              type="button"
              onClick={terminalFailure ? recoverPending : retry}
              disabled={busy}
            >
              {terminalFailure ? "入力に戻す" : "再接続・再試行"}
            </button>
          )}
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
          disabled={busy || pending !== null}
        />
        <button type="submit" disabled={busy || pending !== null || input.trim().length === 0}>
          送信
        </button>
      </form>
    </div>
  );
};
