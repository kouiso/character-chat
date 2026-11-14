import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { useMessageMarks } from "../hook/use-message-marks";
import { useVoiceCall } from "../hook/use-voice-call";
import { runBranchAction } from "../lib/branch";
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
  requestChatImage,
  writeChatSession,
  type ChatBubble,
  type ChatImageParams,
  type PendingTurn,
} from "../lib/chat-session";
import { revealChunk, scheduleReveal } from "../lib/chunk-reveal";
import { playVoiceText, readVoiceAutoplay, type VoicePlayback } from "../lib/tts";

import { BranchControls } from "./branch-controls";
import { ChatHeaderControls } from "./chat-header-controls";
import { ChatImage } from "./chat-image";
import { ChatMessage, ChatMessageText } from "./chat-message";
import { ChatMessageLog } from "./chat-message-log";
import { GalleryPanel } from "./gallery-panel";
import { LedgerPanel } from "./ledger-panel";
import { MessageActions } from "./message-actions";
import { SuggestionChips } from "./suggestion-chips";
import { VoiceButton } from "./voice-button";
import { VoiceCallButton } from "./voice-call-button";

import type { ChatSseEvent } from "../lib/sse-events";

// 直近の確定アシスタント発話（自動再生・通話ループの発話対象）。
const isPlayableAssistant = (bubble: ChatBubble): boolean =>
  bubble.role === "assistant" && !bubble.pending && Boolean(bubble.text);

export type ChatViewProps = {
  characterId: string;
  characterName: string;
  characterAvatar?: string | null;
  initialConversationId?: string;
  newConversationKey?: string;
};

const withPending = (history: ChatBubble[], nextTurn: number, pending: PendingTurn): ChatBubble[] =>
  nextTurn > pending.baseTurn
    ? history
    : [
        ...history,
        { role: "user", text: pending.text },
        { role: "assistant", text: "", pending: true },
      ];

// バブルに載せる data 属性。ブックマークジャンプと画像ジャンプの起点。
const bubbleDataAttrs = (bubble: ChatBubble) => ({
  ...(bubble.imageUrl ? { "data-image-src": bubble.imageUrl } : {}),
  ...(bubble.id ? { "data-message-id": bubble.id } : {}),
});

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

// 並びの位置を key にすると、前の発言が消えた時に開いた操作欄が次の発言へ付け替わる。
// 一方、枝の切り替えは同じターン・同じ役割の別の行を active にして行の id を変えるので、
// id を key にすると切り替えた行の枝操作欄が作り直されて閉じる。保存済みの行は
// 「ターン + 役割」（active は 1 行だけ・ターン番号は保存値で詰まらない）で区別する。
// 万一同じ組が重なる時だけ id を足して衝突を避ける。id を持たない行は、送信中の返信なら
// 固定名、確定済みの断片なら同じ役割の中での出現順で区別する。
const bubbleKeys = (bubbles: ChatBubble[]): string[] => {
  const groupOf = (bubble: ChatBubble) => `${bubble.turn}:${bubble.role}`;
  const groupCount = new Map<string, number>();
  for (const bubble of bubbles) {
    if (bubble.id === undefined || bubble.turn === undefined) continue;
    groupCount.set(groupOf(bubble), (groupCount.get(groupOf(bubble)) ?? 0) + 1);
  }
  const localCount = { user: 0, assistant: 0 };
  return bubbles.map((bubble) => {
    if (bubble.id !== undefined && bubble.turn !== undefined) {
      const group = groupOf(bubble);
      return (groupCount.get(group) ?? 0) > 1 ? `${group}:${bubble.id}` : group;
    }
    if (bubble.pending) return `pending-${bubble.role}`;
    const key = `local-${bubble.role}-${localCount[bubble.role]}`;
    localCount[bubble.role] += 1;
    return key;
  });
};

const failureMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "返信を確認できませんでした。";

// 画像設定欄の生入力（空欄 = レシピ既定値へ倒す。RIT-183）。
type ImageParamFields = {
  cfg: string;
  seed: string;
  negativePrompt: string;
  width: string;
  height: string;
  strength: string;
};

const EMPTY_IMAGE_PARAMS: ImageParamFields = {
  cfg: "",
  seed: "",
  negativePrompt: "",
  width: "",
  height: "",
  strength: "",
};

// 空欄は未指定として削り、数値欄は整数/実数へ変換する。壊れた入力は
// 黙って捨てず false を返して画面へ理由を出す（サーバの 400 より先に説明できる）。
const parseImageParams = (
  fields: ImageParamFields,
): { ok: true; params: ChatImageParams } | { ok: false } => {
  // 空欄は null、変換できる値は number、壊れた入力は undefined を返す。
  const numberField = (raw: string, int: boolean): number | null | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) && (!int || Number.isInteger(value)) ? value : undefined;
  };
  const parsed = {
    cfg: numberField(fields.cfg, false),
    seed: numberField(fields.seed, true),
    width: numberField(fields.width, true),
    height: numberField(fields.height, true),
    strength: numberField(fields.strength, false),
  };
  if (Object.values(parsed).some((value) => value === undefined)) return { ok: false };
  const params: ChatImageParams = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "number") (params as Record<string, number>)[key] = value;
  }
  const negative = fields.negativePrompt.trim();
  if (negative) params.negativePrompt = negative;
  return { ok: true, params };
};

// 画像生成ボタンの中身。会話がまだサーバへ作られとらん時は先にメッセージ送信を促す。
// imageUrl からメッセージ id を取る（/api/media/<id> 形。i2i 参照元の指定に使う）。
const messageIdOfImage = (imageUrl: string | undefined): string | null => {
  if (!imageUrl) return null;
  const id = imageUrl.split("/").pop();
  return id ? decodeURIComponent(id) : null;
};

type ChatErrorBarProps = {
  error: string;
  canResume: boolean;
  terminalFailure: boolean;
  busy: boolean;
  onRecover: () => void;
  onRetry: () => void;
};

// 最終失敗なら入力へ戻す、途中で切れただけなら同じ受付番号で再接続する。
const ChatErrorBar = ({
  error,
  canResume,
  terminalFailure,
  busy,
  onRecover,
  onRetry,
}: ChatErrorBarProps) => (
  <div className="v2-error" role="alert">
    {error}
    {canResume && (
      <button type="button" onClick={terminalFailure ? onRecover : onRetry} disabled={busy}>
        {terminalFailure ? "入力に戻す" : "再接続・再試行"}
      </button>
    )}
    <a href="/">会話一覧へ戻る</a>
  </div>
);

// バブルのメディア。動画（RIT-190）は video 要素、画像は従来どおり img。
const BubbleMedia = ({ bubble }: { bubble: ChatBubble }) => {
  if (!bubble.imageUrl) return null;
  if (bubble.mediaKind === "video") {
    return <video className="v2-bubble-video" src={bubble.imageUrl} controls preload="metadata" />;
  }
  return <ChatImage src={bubble.imageUrl} />;
};

const runImageRequest = async (deps: {
  characterId: string;
  conversationId: RefObject<string | null>;
  nextTurn: RefObject<number>;
  busy: boolean;
  imageBusy: boolean;
  pending: PendingTurn | null;
  imageParamFields: ImageParamFields;
  // i2i 用: 参照元メッセージ id と表情変更等の依頼文（RIT-184）。
  sourceMessageId?: string;
  instruction?: string;
  setError: Dispatch<SetStateAction<string | null>>;
  setImageBusy: Dispatch<SetStateAction<boolean>>;
  setBubbles: Dispatch<SetStateAction<ChatBubble[]>>;
}): Promise<void> => {
  const targetConversationId = deps.conversationId.current;
  if (!targetConversationId) {
    deps.setError("画像を作る前に、まずメッセージを送って会話を始めてください。");
    return;
  }
  if (deps.busy || deps.imageBusy || deps.pending) return;
  const parsed = parseImageParams(deps.imageParamFields);
  if (!parsed.ok) {
    deps.setError("画像設定の数値を確認してください。");
    return;
  }
  const abort = new AbortController();
  deps.setImageBusy(true);
  deps.setError(null);
  try {
    await requestChatImage(
      deps.characterId,
      targetConversationId,
      {
        ...parsed.params,
        ...(deps.sourceMessageId ? { sourceMessageId: deps.sourceMessageId } : {}),
        ...(deps.instruction ? { instruction: deps.instruction } : {}),
      },
      abort.signal,
    );
    // 画像がターンを1つ消費するので、番号は履歴を読み直してサーバの値に揃える。
    const history = await loadChatHistory(deps.characterId, targetConversationId, abort.signal);
    deps.nextTurn.current = history.nextTurn;
    deps.setBubbles(history.bubbles);
  } catch (cause) {
    deps.setError(failureMessage(cause));
  } finally {
    deps.setImageBusy(false);
  }
};

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
  characterAvatar,
  initialConversationId,
  newConversationKey,
}: ChatViewProps) => {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageParamFields, setImageParamFields] = useState<ImageParamFields>(EMPTY_IMAGE_PARAMS);
  // i2i 表情変更（RIT-184）: 編集中の参照元メッセージ id と依頼文。
  const [i2iTarget, setI2iTarget] = useState<string | null>(null);
  const [i2iInstruction, setI2iInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [terminalFailure, setTerminalFailure] = useState(false);
  // RIT-202: 「ここから戻る」で眠らせた末尾を「進む」で起こせるよう、戻したターンを覚える。
  const [rewoundFrom, setRewoundFrom] = useState<number | null>(null);
  const conversationId = useRef<string | null>(null);
  const nextTurn = useRef(1);
  const controller = useRef<AbortController | null>(null);
  const revealCancel = useRef<(() => void) | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // RIT-211/212: 音声再生。レイヤ連続再生のハンドルを持ち、再生中キーでボタンを切替える。
  const playbackRef = useRef<VoicePlayback | null>(null);
  const callEndRef = useRef<() => void>(() => {});
  const [voiceKey, setVoiceKey] = useState<string | null>(null);
  const bubblesRef = useRef<ChatBubble[]>([]);

  const stopVoice = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setVoiceKey(null);
  }, []);

  const playVoice = (key: string, text: string) => {
    playbackRef.current?.stop();
    setVoiceKey(key);
    playbackRef.current = playVoiceText(characterId, text, () => {
      playbackRef.current = null;
      setVoiceKey(null);
      callEndRef.current();
    });
  };

  const latestAssistant = () => [...bubblesRef.current].reverse().find(isPlayableAssistant);

  // RIT-211: 応答確定後の自動再生。設定 OFF・エンジン未起動は黙ってスルー。
  const maybeAutoplay = async () => {
    if (!(await readVoiceAutoplay())) return;
    const last = latestAssistant();
    if (!last) return;
    playVoice(last.id ?? `t${last.turn ?? 0}`, last.text);
  };

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
      bubblesRef.current = history.bubbles;
      if (reveal) startScheduledReveal(revealCancel, setBubbles, result.texts, result.sendAt);
      else setBubbles(history.bubbles);
    } catch (cause) {
      reportConsumeFailure(cause, signal, setError, setTerminalFailure);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }, []);

  // RIT-204: メッセージへの印（ブックマーク・いいね）。履歴読み込みのたび会話の印も追従する。
  const {
    marks,
    reload: reloadMarks,
    toggle: toggleMessageMark,
  } = useMessageMarks(characterId, conversationId);

  // RIT-202: 枝操作（張替・再生成・書き直し・戻る/進む）の後は履歴を1本読み直すだけ。
  const reloadHistory = useCallback(async () => {
    const targetConversationId = conversationId.current;
    if (!targetConversationId) return;
    const history = await loadChatHistory(
      characterId,
      targetConversationId,
      new AbortController().signal,
    );
    nextTurn.current = history.nextTurn;
    setBubbles(history.bubbles);
    void reloadMarks();
  }, [characterId, reloadMarks]);

  // RIT-202: 枝操作は永続行（id/turn あり・送信完了済み）にだけ出す。
  const bubbleControls = (bubble: ChatBubble) => {
    const targetConversationId = conversationId.current;
    if (
      bubble.id === undefined ||
      bubble.turn === undefined ||
      bubble.pending ||
      !targetConversationId
    )
      return null;
    return (
      <>
        <BranchControls
          characterId={characterId}
          conversationId={targetConversationId}
          role={bubble.role}
          turn={bubble.turn}
          busy={busy || pending !== null}
          onChanged={reloadHistory}
          onRewound={setRewoundFrom}
        />
        <MessageActions
          messageId={bubble.id}
          role={bubble.role}
          text={bubble.text}
          marks={marks}
          onToggle={(kind, value) =>
            toggleMessageMark({ messageId: bubble.id, kind, value }, (cause) =>
              setError((cause as Error).message),
            )
          }
        />
      </>
    );
  };

  // RIT-211: キャラ応答は自動再生設定に関わらず手動再生できる。
  const voiceButtonOf = (bubble: ChatBubble) => {
    if (bubble.role !== "assistant" || !bubble.text || bubble.pending) return null;
    const key = bubble.id ?? `t${bubble.turn ?? 0}`;
    return (
      <VoiceButton
        playing={voiceKey === key}
        busy={false}
        onPlay={() => void playVoice(key, bubble.text)}
        onStop={stopVoice}
      />
    );
  };

  const restoreRewound = async () => {
    if (rewoundFrom === null || !conversationId.current) return;
    setBusy(true);
    try {
      await runBranchAction(characterId, conversationId.current, {
        action: "restore",
        fromTurn: rewoundFrom,
      });
      setRewoundFrom(null);
      await reloadHistory();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
        void reloadMarks();
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
  }, [characterId, consume, initialConversationId, newConversationKey, reloadMarks]);

  // RIT-203: 候補チップからも同じ送信経路を使えるよう本文だけ受ける形に分ける。
  const sendText = async (text: string) => {
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
    void maybeAutoplay();
  };

  // RIT-213: STT→送信→TTS の通話ループ。再生終了は callEndRef 経由で listen へ戻る。
  const voiceCall = useVoiceCall({ sendText, latestAssistant, playVoice });
  useEffect(() => {
    callEndRef.current = voiceCall.onPlaybackEnded;
  });

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    await sendText(input.trim());
  };

  const requestImage = () =>
    void runImageRequest({
      characterId,
      conversationId,
      nextTurn,
      busy,
      imageBusy,
      pending,
      imageParamFields,
      setError,
      setImageBusy,
      setBubbles,
    });

  const requestI2i = () => {
    if (!i2iTarget || !i2iInstruction.trim()) return;
    void runImageRequest({
      characterId,
      conversationId,
      nextTurn,
      busy,
      imageBusy,
      pending,
      imageParamFields,
      sourceMessageId: i2iTarget,
      instruction: i2iInstruction.trim(),
      setError,
      setImageBusy,
      setBubbles,
    });
    setI2iTarget(null);
    setI2iInstruction("");
  };

  // 設定欄の1項目。label と入力だけの最小構造に留め、既定値は placeholder で示す。
  // 数値欄は type=number（spinbutton）にして会話入力の textbox とロールを分ける。
  const paramField = (
    key: keyof ImageParamFields,
    label: string,
    placeholder: string,
    type: "number" | "text" = "number",
    step = "1",
  ) => (
    <label className="v2-image-param">
      <span>{label}</span>
      <input
        type={type}
        step={step}
        value={imageParamFields[key]}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) =>
          setImageParamFields((previous) => ({ ...previous, [key]: event.target.value }))
        }
      />
    </label>
  );

  const retry = () => {
    if (!pending || busy) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    void consume(pending, abort.signal, true);
  };

  // ギャラリー（RIT-185）からの「会話へ」。バブルの data-image-src（=/api/media/<messageId>）で
  // 該当メッセージを見つけてスクロールする。属性値の照合なのでエスケープ問題を避ける。
  const jumpToMessage = (imageUrl: string) => {
    const target = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[data-image-src]") ?? [],
    ).find((element) => element.dataset.imageSrc === imageUrl);
    target?.scrollIntoView({ block: "center" });
  };

  // ギャラリーから画像を消すとタイムラインの画像メッセージも消えるので、履歴を読み直す。
  const reloadAfterGalleryChange = async () => {
    const targetConversationId = conversationId.current;
    if (!targetConversationId) return;
    const abort = new AbortController();
    try {
      const history = await loadChatHistory(characterId, targetConversationId, abort.signal);
      nextTurn.current = history.nextTurn;
      setBubbles(history.bubbles);
    } catch (cause) {
      setError(failureMessage(cause));
    }
  };

  const [showInner, setShowInner] = useState(true);
  const jumpToMessageId = (messageId: string) => {
    const target = rootRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    target?.scrollIntoView({ block: "center" });
  };

  const keys = bubbleKeys(bubbles);

  return (
    <div className="v2-chat" data-hide-inner={!showInner} ref={rootRef}>
      <div className="v2-chat-header">
        <ChatMessageText text={characterName} />
        <ChatHeaderControls
          characterId={characterId}
          showInner={showInner}
          getConversationId={() => conversationId.current}
          onToggleInner={() => setShowInner((prev) => !prev)}
          onJumpMessage={jumpToMessageId}
        />
        <LedgerPanel characterId={characterId} getConversationId={() => conversationId.current} />
        <VoiceCallButton
          state={voiceCall.state}
          remaining={voiceCall.remaining}
          onStart={() => void voiceCall.start()}
          onStop={voiceCall.stop}
        />
        <GalleryPanel
          characterId={characterId}
          getConversationId={() => conversationId.current}
          onJumpToMessage={jumpToMessage}
          onChanged={() => void reloadAfterGalleryChange()}
        />
      </div>
      <ChatMessageLog key={characterId} busy={busy}>
        {bubbles.map((bubble, index) => (
          // LINE 型の見た目に寄せるため、相手の発言はアイコン付きの行にする（本人専用の顔出し）。
          <div key={keys[index]} className={`v2-turn-row ${bubble.role}`}>
            {bubble.role === "assistant" && (
              <span className="v2-avatar" aria-hidden>
                {characterName.slice(0, 1)}
                {characterAvatar && (
                  // 画像が無い・404 の時は外して頭文字へ戻す（公式キャラは /avatars/ で配信）。
                  <img src={characterAvatar} alt="" onError={(e) => e.currentTarget.remove()} />
                )}
              </span>
            )}
            <div
              className={`v2-bubble v2-message-turn ${bubble.role} ${bubble.pending ? "pending" : ""}`}
              {...bubbleDataAttrs(bubble)}
            >
              <BubbleMedia bubble={bubble} />
              {bubble.imageUrl &&
                bubble.mediaKind !== "video" &&
                messageIdOfImage(bubble.imageUrl) && (
                  <div className="v2-i2i">
                    {i2iTarget === messageIdOfImage(bubble.imageUrl) ? (
                      <>
                        <input
                          value={i2iInstruction}
                          onChange={(event) => setI2iInstruction(event.target.value)}
                          placeholder="例: 怒った顔"
                          aria-label="表情変更の依頼"
                        />
                        <button
                          type="button"
                          onClick={requestI2i}
                          disabled={[
                            busy,
                            imageBusy,
                            pending !== null,
                            !i2iInstruction.trim(),
                          ].some(Boolean)}
                        >
                          生成
                        </button>
                        <button type="button" onClick={() => setI2iTarget(null)}>
                          やめる
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setI2iTarget(messageIdOfImage(bubble.imageUrl))}
                        disabled={[busy, imageBusy, pending !== null].some(Boolean)}
                      >
                        表情変更
                      </button>
                    )}
                  </div>
                )}
              <ChatMessage
                role={bubble.role}
                text={bubble.text || (bubble.pending ? "…" : "")}
                characterName={characterName}
                streaming={bubble.pending}
              />
              {bubbleControls(bubble)}
              {voiceButtonOf(bubble)}
            </div>
          </div>
        ))}
      </ChatMessageLog>
      {rewoundFrom !== null && (
        <div className="v2-branch-restore">
          <button type="button" onClick={() => void restoreRewound()} disabled={busy}>
            戻した会話を進む（復元）
          </button>
        </div>
      )}
      {error && (
        <ChatErrorBar
          error={error}
          canResume={pending !== null}
          terminalFailure={terminalFailure}
          busy={busy}
          onRecover={recoverPending}
          onRetry={retry}
        />
      )}
      <details className="v2-image-params">
        <summary>画像設定</summary>
        <div className="v2-image-params-grid">
          {paramField("cfg", "CFG", "5", "number", "0.5")}
          {paramField("seed", "seed", "ランダム")}
          {paramField("width", "幅", "832", "number", "8")}
          {paramField("height", "高さ", "1216", "number", "8")}
          {paramField("strength", "i2i強度", "0.45", "number", "0.05")}
          {paramField("negativePrompt", "ネガティブプロンプト", "既定", "text")}
        </div>
      </details>
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
        <SuggestionChips
          characterId={characterId}
          getConversationId={() => conversationId.current}
          disabled={busy || pending !== null}
          onPick={(text) => void sendText(text)}
          onError={setError}
        />
        <button
          type="button"
          onClick={() => void requestImage()}
          disabled={[busy, imageBusy, pending !== null].some(Boolean)}
        >
          {imageBusy ? "生成中…" : "画像"}
        </button>
        <button type="submit" disabled={busy || pending !== null || input.trim().length === 0}>
          送信
        </button>
      </form>
    </div>
  );
};
