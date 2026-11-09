import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";
import {
  ChatConnectionError,
  ChatRequestRejectedError,
  ChatTurnActiveError,
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
import { revealChunk, scheduleReveal } from "../lib/chunk-reveal";
import { requestImageGeneration, waitImageGeneration } from "../lib/image-request";

import { ChatImage } from "./chat-image";
import { ChatMessage, ChatMessageText } from "./chat-message";
import { ChatMessageLog } from "./chat-message-log";

import type { ChatSseEvent } from "../lib/sse-events";

export type ChatViewProps = {
  characterId: string;
  characterName: string;
  initialConversationId?: string;
  newConversationKey?: string;
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

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "返信を確認できませんでした。";

// 起動から完了確認まで。失敗なら理由文字列、成功・中断なら null。
const runImageGeneration = async (
  characterId: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<string | null> => {
  const generationId = await requestImageGeneration({ characterId, conversationId });
  const result = await waitImageGeneration(generationId, signal);
  if (signal.aborted || result.status === "succeeded") return null;
  return result.reason ?? "画像を生成できませんでした。";
};

type ChatComposerProps = {
  input: string;
  onInput: (value: string) => void;
  onSend: (event: React.FormEvent) => void | Promise<void>;
  onGenerateImage: () => void;
  sending: boolean;
  imageBusy: boolean;
  canGenerateImage: boolean;
};

const ChatComposer = ({
  input,
  onInput,
  onSend,
  onGenerateImage,
  sending,
  imageBusy,
  canGenerateImage,
}: ChatComposerProps) => (
  <form
    className="v2-chat-form"
    onSubmit={(event) => {
      void onSend(event);
    }}
  >
    <button
      type="button"
      onClick={onGenerateImage}
      disabled={sending || imageBusy || !canGenerateImage}
      title={canGenerateImage ? undefined : "会話を始めると画像を生成できます"}
    >
      画像生成
    </button>
    <input
      value={input}
      onChange={(event) => onInput(event.target.value)}
      placeholder="メッセージを入力"
      aria-label="メッセージ"
      disabled={sending}
    />
    <button type="submit" disabled={sending || input.trim().length === 0}>
      送信
    </button>
  </form>
);

const resolveInitialConversation = (
  characterId: string,
  initialConversationId: string | undefined,
  newConversationKey: string | undefined,
): { conversationId?: string; missingKey?: boolean; storageError?: boolean } => {
  if (!newConversationKey || initialConversationId) {
    return { conversationId: initialConversationId };
  }
  try {
    const conversationId =
      localStorage.getItem(`v2-new-chat:${characterId}:${newConversationKey}`) ?? undefined;
    return conversationId ? { conversationId } : { missingKey: true };
  } catch {
    return { storageError: true };
  }
};

type ChatErrorEvent = Extract<ChatSseEvent, { type: "error" }>;

const isTerminalPendingRejection = (pending: PendingTurn | null, cause: unknown): boolean =>
  pending !== null && cause instanceof ChatRequestRejectedError;

const consumeEvents = async (
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onError: (event: ChatErrorEvent) => void,
): Promise<{ completed: boolean; texts: string[]; sendAt?: number[] }> => {
  const chunks = new Map<number, string>();
  let completed = false;
  let sendAt: number[] | undefined;
  for await (const event of readChatEvents(stream)) {
    if (signal.aborted) return { completed: false, texts: [] };
    if (event.type === "chunk") chunks.set(event.seq, event.text);
    if (event.type === "error") {
      onError(event);
      throw new Error(event.message);
    }
    if (event.type === "done") {
      completed = true;
      sendAt = event.sendAt;
    }
  }
  return {
    completed,
    sendAt,
    texts: [...chunks.entries()].sort(([a], [b]) => a - b).map(([, value]) => value),
  };
};

// 完了だけ届いた再接続は塊が無いので、空の作成中枠を外して履歴の読み直しで埋める。
const dropPendingAssistant = (setBubbles: Dispatch<SetStateAction<ChatBubble[]>>) =>
  setBubbles((previous) =>
    previous
      .filter((bubble) => !(bubble.pending && bubble.role === "assistant" && !bubble.text))
      .map((bubble) => ({ ...bubble, pending: false })),
  );

const reportConsumeFailure = (
  cause: unknown,
  signal: AbortSignal,
  setError: Dispatch<SetStateAction<string | null>>,
  setTerminalFailure: Dispatch<SetStateAction<boolean>>,
) => {
  if (signal.aborted) return;
  if (cause instanceof ChatRequestRejectedError) setTerminalFailure(true);
  setError(failureMessage(cause));
};

const startScheduledReveal = (
  revealCancel: RefObject<(() => void) | null>,
  setBubbles: Dispatch<SetStateAction<ChatBubble[]>>,
  texts: string[],
  sendAt: number[] | undefined,
) => {
  revealCancel.current?.();
  revealCancel.current = scheduleReveal(texts, sendAt, (text, more) =>
    setBubbles((previous) => revealChunk(previous, text, more)),
  );
};

export const ChatView = ({
  characterId,
  characterName,
  initialConversationId,
  newConversationKey,
}: ChatViewProps) => {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [terminalFailure, setTerminalFailure] = useState(false);
  const conversationId = useRef<string | null>(null);
  const nextTurn = useRef(1);
  const controller = useRef<AbortController | null>(null);
  const revealCancel = useRef<(() => void) | null>(null);

  const consume = useCallback(async (turn: PendingTurn, signal: AbortSignal, retry = false) => {
    if (signal.aborted) return;
    setBusy(true);
    setError(null);
    setTerminalFailure(false);
    try {
      const stream = await connectChatTurn(turn, signal, retry);
      const result = await consumeEvents(stream, signal, (event) =>
        setTerminalFailure(event.terminal === true),
      );
      if (!result.completed) throw new ChatConnectionError();
      // サーバーが完了を確かめた時点で保留を片付ける。履歴の読み直しで失敗しても、
      // 保存済みの送信を「入力に戻す」で戻して二重に送らせんため。
      clearPendingTurn(turn.characterId, turn);
      setPending(null);
      // 塊が取れたターンは予定時刻で順に出す（RIT-69）。完了だけ届いた再接続は
      // 塊が無いので、従来どおり履歴の読み直しで埋める。
      const reveal = result.texts.length > 0;
      if (!reveal) dropPendingAssistant(setBubbles);
      nextTurn.current = turn.baseTurn + 1;
      const history = await loadChatHistory(turn.characterId, turn.conversationId, signal);
      if (signal.aborted) return;
      nextTurn.current = history.nextTurn;
      if (reveal) startScheduledReveal(revealCancel, setBubbles, result.texts, result.sendAt);
      else setBubbles(history.bubbles);
    } catch (cause) {
      reportConsumeFailure(cause, signal, setError, setTerminalFailure);
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
        // まだ作成中の送信を戻すと、返信が後から保存されて二重になる。再接続へ戻す。
        if (cause instanceof ChatTurnActiveError) {
          setTerminalFailure(false);
          setError(cause.message);
          return;
        }
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
      const resolved = resolveInitialConversation(
        characterId,
        initialConversationId,
        newConversationKey,
      );
      if (resolved.storageError) {
        setError("この端末に保存した会話を確認できません。保存設定を確認してください。");
        return;
      }
      if (resolved.missingKey) return;
      const targetConversationId = resolved.conversationId;
      const saved = readChatSession(characterId, targetConversationId);
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
          if (isTerminalPendingRejection(saved.pending, cause)) setTerminalFailure(true);
          setError("会話を再開できませんでした。再試行してください。");
          setBusy(false);
        }
      }
    };
    void restore();
    return () => {
      abort.abort();
      controller.current?.abort();
      revealCancel.current?.();
      revealCancel.current = null;
    };
  }, [characterId, consume, initialConversationId, newConversationKey]);

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
      if (newConversationKey) {
        localStorage.setItem(
          `v2-new-chat:${characterId}:${newConversationKey}`,
          turn.conversationId,
        );
      }
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

  // 会話起点の画像生成（RIT-182）。会話が無い間は起動できん（会話の場面から描くため）。
  const generateImage = async () => {
    const conversation = conversationId.current;
    if (!conversation || busy || imageBusy) return;
    setImageBusy(true);
    setError(null);
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const finish = (message: string | null) => {
      if (abort.signal.aborted) return;
      if (message) setError(message);
      setImageBusy(false);
    };
    try {
      const failure = await runImageGeneration(characterId, conversation, abort.signal);
      if (failure) {
        finish(`画像を生成できませんでした: ${failure}`);
        return;
      }
      // 画像は新しいメッセージとして履歴へ入る。読み直しで表示に載せる。
      const history = await loadChatHistory(characterId, conversation, abort.signal);
      if (abort.signal.aborted) return;
      nextTurn.current = history.nextTurn;
      setBubbles(history.bubbles);
      finish(null);
    } catch (cause) {
      finish(cause instanceof Error ? cause.message : "画像を生成できませんでした。");
    }
  };

  return (
    <div className="v2-chat">
      <div className="v2-chat-header">
        <ChatMessageText text={characterName} />
      </div>
      <ChatMessageLog key={characterId} busy={busy}>
        {bubbles.map((bubble, index) => (
          <div
            key={index}
            className={`v2-bubble v2-message-turn ${bubble.role} ${bubble.pending ? "pending" : ""}`}
          >
            {bubble.imageUrl && <ChatImage src={bubble.imageUrl} />}
            <ChatMessage
              role={bubble.role}
              text={bubble.text || (bubble.pending ? "…" : "")}
              characterName={characterName}
              streaming={bubble.pending}
            />
          </div>
        ))}
      </ChatMessageLog>
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
      {imageBusy && (
        <div className="v2-image-status" role="status">
          画像を生成しています…
        </div>
      )}
      <ChatComposer
        input={input}
        onInput={setInput}
        onSend={send}
        onGenerateImage={() => {
          void generateImage();
        }}
        sending={busy || pending !== null}
        imageBusy={imageBusy}
        canGenerateImage={conversationId.current !== null}
      />
    </div>
  );
};
