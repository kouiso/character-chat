import { useCallback, useEffect, useRef, useState } from "react";

import {
  connectChatTurn,
  loadChatHistory,
  readChatEvents,
  readChatSession,
  writeChatSession,
  type ChatBubble,
  type PendingTurn,
} from "../lib/chat-session";

import { ChatMessage } from "./chat-message";

export type ChatViewProps = { characterId: string; characterName: string };

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

const updateAssistant = (history: ChatBubble[], text: string): ChatBubble[] =>
  history.map((bubble, index) =>
    index === history.length - 1 && bubble.role === "assistant"
      ? { ...bubble, text, pending: true }
      : bubble,
  );

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "返信を確認できませんでした。";

export const ChatView = ({ characterId, characterName }: ChatViewProps) => {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const conversationId = useRef<string | null>(null);
  const nextTurn = useRef(1);
  const controller = useRef<AbortController | null>(null);

  const consume = useCallback(async (turn: PendingTurn, signal: AbortSignal, retry = false) => {
    setBusy(true);
    setError(null);
    try {
      const stream = await connectChatTurn(turn, signal, retry);
      const chunks = new Map<number, string>();
      let completed = false;
      for await (const event of readChatEvents(stream)) {
        if (event.type === "chunk") {
          chunks.set(event.seq, event.text);
          const text = [...chunks.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, value]) => value)
            .join("\n");
          setBubbles((previous) => updateAssistant(previous, text));
        }
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") completed = true;
      }
      if (!completed) throw new Error("接続が切れました。再接続してください。");
      const history = await loadChatHistory(turn.characterId, turn.conversationId, signal);
      writeChatSession(turn.characterId, {
        version: 1,
        conversationId: turn.conversationId,
        pending: null,
      });
      nextTurn.current = history.nextTurn;
      setBubbles(history.bubbles);
      setPending(null);
    } catch (cause) {
      if (!signal.aborted) setError(failureMessage(cause));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const restore = async () => {
      const saved = readChatSession(characterId);
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
      } catch {
        if (!abort.signal.aborted) {
          setError("会話を再開できませんでした。再試行してください。");
          setBusy(false);
        }
      }
    };
    void restore();
    return () => abort.abort();
  }, [characterId, consume]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || pending) return;
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
            <button type="button" onClick={retry} disabled={busy}>
              再接続・再試行
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
