import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { useMessageMarks } from "../hook/use-message-marks";
import { useVoiceCall } from "../hook/use-voice-call";
import { runBranchAction } from "../lib/branch";
import { MAX_MESSAGE_LENGTH } from "../lib/chat-limits";
import {
  ChatConnectionError,
  ChatDailyLimitError,
  ChatRequestRejectedError,
  ChatRoomBusyError,
  ChatTurnActiveError,
  clearPendingTurn,
  isPendingSaved,
  loadChatHistory,
  readChatSession,
  readChatTurnState,
  requestChatImage,
  stopChatTurn,
  withdrawChatTurn,
  writeChatSession,
  writePendingTurn,
  type ChatBubble,
  type ChatImageParams,
  type PendingTurn,
  type StoredTurn,
  type TurnStateRequest,
} from "../lib/chat-session";
import { revealChunk, scheduleReveal } from "../lib/chunk-reveal";
import { useChatOnline } from "../lib/chat-online";
import { isFailurePhase, isWaitingPhase, markerText, type TurnPhase } from "../lib/turn-phase";
import { followTurn } from "../lib/turn-stream";
import { playVoiceText, readVoiceAutoplay, type VoicePlayback } from "../lib/tts";

import { BranchControls } from "./branch-controls";
import { BookmarkPanel } from "./bookmark-panel";
import { ChatHeaderControls } from "./chat-header-controls";
import { ChatImage } from "./chat-image";
import { ChatMessage, ChatMessageText } from "./chat-message";
import { ChatMessageLog } from "./chat-message-log";
import { LearnedMemoryLink } from "./learned-memory-link";
import { GalleryPanel } from "./gallery-panel";
import { LedgerPanel } from "./ledger-panel";
import { MessageActions } from "./message-actions";
import { SuggestionChips } from "./suggestion-chips";
import {
  StoppedMarker,
  TurnFailureBox,
  TurnMarker,
  TurnMessageAction,
  TurnStopButton,
  failureActionsFor,
  failureCopy,
  type FailureAction,
} from "./chat-turn-failure";
import { ChatWaiting } from "./chat-waiting";
import { VoiceButton } from "./voice-button";
import { VoiceCallButton } from "./voice-call-button";
import { TalkIcon } from "./talk-icon";
import { TalkSheet } from "./talk-sheet";
import { TalkSceneBar } from "./talk-scene-bar";
import { ProactiveToggle } from "./proactive-toggle";
import "./talk-screen.css";

import type { ChatSseEvent } from "../lib/sse-events";

// 直近の確定アシスタント発話（自動再生・通話ループの発話対象）。
const isPlayableAssistant = (bubble: ChatBubble): boolean =>
  bubble.role === "assistant" && !bubble.pending && Boolean(bubble.text);

export type ChatViewProps = {
  backSlot?: React.ReactNode;
  characterId: string;
  characterName: string;
  characterAvatar?: string | null;
  // 会話が始まる前にキャラが差し出す「初回のひとこと」。履歴に無い表示専用の冒頭バブル。
  characterGreeting?: string | null;
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

// 「もう一度」が効かん失敗の code（部屋が書く failure_code と同じ集合）。
// 開き直しと出来事の受けの両方で同じ分け方を使う。
const REJECT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "withdrawn",
  "conflict",
  "conversation_advanced",
  "conversation_rewound",
  // 試行回数を使い切った送信は「もう一度」が無い（板 TalkError 5）。
  "attempt_limit",
]);

// 開き直しの受付の調べ結果から、続き方を決める。
// "attach" は部屋へつなぎ直し。それ以外はその失敗の状態の枠へ進む。
const resumeActionFor = (request: TurnStateRequest | null): "attach" | "stopped" | TurnPhase => {
  if (request === null) return "send_failed";
  if (
    request.status === "queued" ||
    request.status === "running" ||
    request.status === "succeeded"
  ) {
    return "attach";
  }
  if (request.status === "stopped") return "stopped";
  if (request.status !== "failed") return "send_failed";
  // 確定的な拒否は「入力に戻す」の枠、それ以外は「返事が届かなかった」枠へ。
  return request.failureCode !== null &&
    request.failureCode !== undefined &&
    REJECT_FAILURE_CODES.has(request.failureCode)
    ? "rejected"
    : "no_reply";
};

// 部品 C（発言の左の操作）を出す行の番号。「送れなかった」系の時、
// pending と文が一致する本人の発言の行だけ。-1 は「出さん」。
const actionIndexFor = (
  phase: TurnPhase,
  pending: PendingTurn | null,
  bubbles: ChatBubble[],
): number => {
  if (pending === null) return -1;
  if (phase !== "send_failed" && phase !== "resending" && phase !== "rejected") return -1;
  return bubbles.findIndex((bubble) => bubble.role === "user" && bubble.text === pending.text);
};

type ChatErrorBarProps = {
  error: string;
  canResume: boolean;
  terminalFailure: boolean;
  busy: boolean;
  onRecover: () => void;
  onRetry: () => void;
};

// 再接続と入力へ戻す道を常に並べる。失敗の種類を画面が決めると、戻したい時に再試行を重ねさせる。
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
      <>
        {!terminalFailure && (
          <button type="button" onClick={onRetry} disabled={busy}>
            再接続・再試行
          </button>
        )}
        <button type="button" onClick={onRecover} disabled={busy}>
          入力に戻す
        </button>
      </>
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

// 画像バブルの「表情変更」（i2i）の入口と入力欄。対象の画像で無い時はボタンだけ。
const I2iSlot = ({
  bubble,
  open,
  instruction,
  disabled,
  onOpen,
  onInstruction,
  onSubmit,
}: {
  bubble: ChatBubble;
  open: string | null;
  instruction: string;
  disabled: boolean;
  onOpen: (target: string | null) => void;
  onInstruction: (value: string) => void;
  onSubmit: () => void;
}) => {
  const messageId = bubble.mediaKind === "video" ? null : messageIdOfImage(bubble.imageUrl);
  if (messageId === null) return null;
  if (open !== messageId) {
    return (
      <div className="v2-i2i">
        <button type="button" onClick={() => onOpen(messageId)} disabled={disabled}>
          表情変更
        </button>
      </div>
    );
  }
  return (
    <div className="v2-i2i">
      <input
        value={instruction}
        onChange={(event) => onInstruction(event.target.value)}
        placeholder="例: 怒った顔"
        aria-label="表情変更の依頼"
      />
      <button type="button" onClick={onSubmit} disabled={disabled || !instruction.trim()}>
        生成
      </button>
      <button type="button" onClick={() => onOpen(null)}>
        やめる
      </button>
    </div>
  );
};

type ChatFooterProps = {
  trayContent: React.ReactNode;
  busy: boolean;
  imageBusy: boolean;
  pending: PendingTurn | null;
  phase: TurnPhase;
  error: string | null;
  failure: { primary: string; secondary?: string } | null;
  failureActions: FailureAction[];
  rewoundFrom: number | null;
  onRestoreRewound: () => Promise<void>;
  onWithdraw: () => void;
  onRetry: () => void;
  stopping: boolean;
  onStop: () => void;
  input: string;
  onInput: Dispatch<SetStateAction<string>>;
  onSubmit: (event: React.FormEvent) => Promise<void>;
  onPick: (text: string) => Promise<void>;
  onImage: () => void;
  characterId: string;
  getConversationId: () => string | null;
  onError: Dispatch<SetStateAction<string | null>>;
  paramField: (
    key: keyof ImageParamFields,
    label: string,
    placeholder: string,
    type?: "number" | "text",
    step?: string,
  ) => React.ReactNode;
};

const ChatTray = ({
  busy,
  imageBusy,
  pending,
  onImage,
  trayContent,
  paramField,
}: Pick<
  ChatFooterProps,
  "busy" | "imageBusy" | "pending" | "onImage" | "trayContent" | "paramField"
>) => (
  <section className="v2-talk-tray" aria-label="トークの操作">
    <div className="v2-talk-handle" aria-hidden="true" />
    <p className="v2-talk-caption">よく使う</p>
    <button
      type="button"
      className="v2-talk-image-request"
      onClick={onImage}
      disabled={[busy, imageBusy, pending !== null].some(Boolean)}
    >
      <TalkIcon name="image" />
      {imageBusy ? "描いています" : "画像をもらう"}
    </button>
    <div className="v2-talk-tray-settings">{trayContent}</div>
    <details className="v2-image-params">
      <summary>もらう画像の設定</summary>
      <div className="v2-image-params-grid">
        {paramField("cfg", "CFG", "5", "number", "0.5")}
        {paramField("seed", "seed", "ランダム")}
        {paramField("width", "幅", "832", "number", "8")}
        {paramField("height", "高さ", "1216", "number", "8")}
        {paramField("strength", "i2i強度", "0.45", "number", "0.05")}
        {paramField("negativePrompt", "ネガティブプロンプト", "既定", "text")}
      </div>
    </details>
  </section>
);

// 入力の行とその上の通知。待っている間は送信ボタンを「止める」と入れ替える（部品 D）。
const ChatFooter = ({
  trayContent,
  busy,
  imageBusy,
  pending,
  phase,
  error,
  failure,
  failureActions,
  rewoundFrom,
  onRestoreRewound,
  onWithdraw,
  onRetry,
  stopping,
  onStop,
  input,
  onInput,
  onSubmit,
  onPick,
  onImage,
  characterId,
  getConversationId,
  onError,
  paramField,
}: ChatFooterProps) => {
  const [trayOpen, setTrayOpen] = useState(false);
  return (
    <div className="v2-talk-footer">
      {rewoundFrom !== null && (
        <div className="v2-branch-restore">
          <button type="button" onClick={() => void onRestoreRewound()} disabled={busy}>
            戻した会話を進む（復元）
          </button>
        </div>
      )}
      {error && (
        <ChatErrorBar
          error={error}
          canResume={pending !== null && !isFailurePhase(phase)}
          terminalFailure={phase === "rejected"}
          busy={busy}
          onRecover={onWithdraw}
          onRetry={onRetry}
        />
      )}
      {failure !== null && <TurnFailureBox {...failure} actions={failureActions} />}
      {trayOpen && (
        <ChatTray
          busy={busy}
          imageBusy={imageBusy}
          pending={pending}
          onImage={onImage}
          trayContent={trayContent}
          paramField={paramField}
        />
      )}
      <SuggestionChips
        characterId={characterId}
        getConversationId={getConversationId}
        disabled={busy || pending !== null}
        onPick={(text) => void onPick(text)}
        onError={onError}
      />
      <form
        className="v2-chat-form"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <button
          type="button"
          className="v2-talk-plus"
          aria-label={trayOpen ? "閉じる" : "ひらく（画像・電話・しおり・場面）"}
          aria-expanded={trayOpen}
          onClick={() => setTrayOpen(!trayOpen)}
        >
          <TalkIcon name={trayOpen ? "close" : "plus"} />
        </button>
        <input
          value={input}
          onChange={(event) => onInput(event.target.value)}
          placeholder="なに話す？"
          aria-label="メッセージ"
          disabled={imageBusy}
        />
        {isWaitingPhase(phase) ? (
          // 部品 D: 待っている間は送信ボタンと入れ替わる（FR-6）。
          <TurnStopButton disabled={stopping} onClick={onStop} />
        ) : (
          <button
            type="submit"
            aria-label="送信"
            disabled={[busy, pending !== null, input.trim().length === 0].some(Boolean)}
          >
            <TalkIcon name="send" />
          </button>
        )}
      </form>
    </div>
  );
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

// 完了だけ届いた再接続は塊が無いので、空の作成中枠を外して履歴の読み直しで埋める。
const dropPendingAssistant = (setBubbles: Dispatch<SetStateAction<ChatBubble[]>>) =>
  setBubbles((previous) =>
    previous
      .filter((bubble) => !(bubble.pending && bubble.role === "assistant" && !bubble.text))
      .map((bubble) => ({ ...bubble, pending: false })),
  );

// 「もう一度」の再送は、最後の失敗が「失敗の出来事を受けた」か「つながらなかった」かで
// 中身が違う（板 TalkError 3・4 は retry: true、それ以外はつなぎ直し）。
type LastFailure = "event" | "connect" | null;

// ここを超えて返事が来ん時は「少し時間がかかっています」の副の文を足す（板 TalkWaiting-3）。
// 部屋側の ping 間隔（15 秒）と揃えた。出来事が流れ続けても長いなら出る。
const WAIT_SLOW_MS = 15_000;

const startScheduledReveal = (
  revealCancel: RefObject<(() => void) | null>,
  setBubbles: Dispatch<SetStateAction<ChatBubble[]>>,
  texts: string[],
  sendAt: number[] | undefined,
  onShown?: (index: number, more: boolean) => void,
) => {
  revealCancel.current?.();
  let index = 0;
  revealCancel.current = scheduleReveal(texts, sendAt, (text, more) => {
    const shown = index;
    index += 1;
    setBubbles((previous) => revealChunk(previous, text, more));
    onShown?.(shown, more);
  });
};

// 「初回のひとこと」の冒頭バブル。履歴に無い表示専用なので id/turn・枝操作は付けん。
const GREETING_ROLE = "assistant";
const GreetingRow = ({
  name,
  avatar,
  text,
}: {
  name: string;
  avatar?: string | null;
  text: string | null;
}) =>
  !text ? null : (
    <div className="v2-turn-row assistant">
      <span className="v2-avatar" aria-hidden>
        {name.slice(0, 1)}
        {avatar && <img src={avatar} alt="" onError={(e) => e.currentTarget.remove()} />}
      </span>
      <div className="v2-bubble v2-message-turn assistant">
        <ChatMessage role={GREETING_ROLE} text={text} characterName={name} />
      </div>
    </div>
  );

const TalkBack = ({ slot }: { slot?: React.ReactNode }) =>
  slot ?? (
    <a href="/" aria-label="戻る">
      <TalkIcon name="back" />
    </a>
  );

const TalkPortrait = ({ src }: { src?: string | null }) => (
  <div className="v2-talk-portrait" aria-hidden="true">
    {src && <img src={src} alt="" />}
  </div>
);

export const ChatView = ({
  backSlot,
  characterId,
  characterName,
  characterAvatar,
  characterGreeting,
  initialConversationId,
  newConversationKey,
}: ChatViewProps) => {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  // 「初回のひとこと」は会話が空の時だけ差し出す。一度出したらこの画面を閉じるまで残す
  //（最初の返信が来ても消えんほうが、会話が誰の言葉で始まったか分かる）。
  const [greeting, setGreeting] = useState<string | null>(characterGreeting?.trim() || null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageParamFields, setImageParamFields] = useState<ImageParamFields>(EMPTY_IMAGE_PARAMS);
  // i2i 表情変更（RIT-184）: 編集中の参照元メッセージ id と依頼文。
  const [i2iTarget, setI2iTarget] = useState<string | null>(null);
  const [i2iInstruction, setI2iInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  // RIT-65: 送信状態。出口の表はこの状態から描く。
  const [phase, setPhase] = useState<TurnPhase>("idle");
  // 「ここで止めました」の行は、止めた画面を開いている間だけ出す（次の送信で消える）。
  const [stoppedNotice, setStoppedNotice] = useState(false);
  // 1 日の上限（429）の時だけ、部品 B の副の文をサーバの文へ差し替える。
  const [dailyLimitMessage, setDailyLimitMessage] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // RIT-202: 「ここから戻る」で眠らせた末尾を「進む」で起こせるよう、戻したターンを覚える。
  const [rewoundFrom, setRewoundFrom] = useState<number | null>(null);
  const conversationId = useRef<string | null>(null);
  const nextTurn = useRef(1);
  const controller = useRef<AbortController | null>(null);
  // 最後の失敗の形（「もう一度」の中身を決める）。
  const lastFailure = useRef<LastFailure>(null);
  // 届いた塊の seq（止めるの shownSeq に使う）と、画面に出た数。
  const chunkSeqs = useRef<number[]>([]);
  const shownCount = useRef(0);
  // done の後に保留を片付けるので、小出しの途中の「止める」用に受付を覚えておく。
  const activeTurn = useRef<PendingTurn | null>(null);
  const revealTexts = useRef<string[] | null>(null);
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

  const online = useChatOnline();

  // 失敗の状態へ移す時の共通処理。画面に残す情報だけここで揃える。
  const enterPhase = useCallback((next: TurnPhase, failure: LastFailure) => {
    lastFailure.current = failure;
    setPhase(next);
  }, []);

  // 送信文を入力欄へ戻し、保留・吹き出し・枠を消す（板 TalkError 6）。
  // 打ちかけの文が在る時は「送信文・半角空白・打ちかけの文」の順につなぐ（FR-3）。
  const restoreSentText = useCallback((turn: PendingTurn, bubbles: ChatBubble[]) => {
    clearPendingTurn(turn.characterId, turn);
    setPending(null);
    setBubbles(bubbles);
    setInput((previous) => (previous.trim() ? `${turn.text} ${previous}` : turn.text));
    setPhase("idle");
    setDailyLimitMessage(null);
  }, []);

  const consume = useCallback(
    async (
      turn: PendingTurn,
      signal: AbortSignal,
      options: { attach?: boolean; retry?: boolean } = {},
    ) => {
      // done のあとの仕上げ: 保留を片付け、履歴を読み直し、塊は予定時刻で順に出す（RIT-69）。
      const finishDone = async (chunks: Map<number, string>, sendAt: number[] | undefined) => {
        // サーバーが完了を確かめた時点で保留を片付ける。履歴の読み直しで失敗しても、
        // 保存済みの送信を「入力に戻す」で戻して二重に送らせんため。
        clearPendingTurn(turn.characterId, turn);
        setPending(null);
        const texts = [...chunks.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
        const reveal = texts.length > 0;
        if (!reveal) dropPendingAssistant(setBubbles);
        nextTurn.current = turn.baseTurn + 1;
        const history = await loadChatHistory(turn.characterId, turn.conversationId, signal).catch(
          () => null,
        );
        if (signal.aborted) return;
        if (history === null) {
          // done は確かめ済み。読み直しだけ失敗した時は失敗の枠へ戻さず、
          // 届いた塊は出したまま、読み直しの失敗だけを知らせる（保留は片付け済み）。
          if (reveal) {
            revealTexts.current = texts;
            startScheduledReveal(revealCancel, setBubbles, texts, sendAt, (index, more) => {
              shownCount.current = index + 1;
              if (!more) {
                revealTexts.current = null;
                activeTurn.current = null;
                setPhase("idle");
              }
            });
          } else {
            activeTurn.current = null;
            setPhase("idle");
          }
          setError("返事の保存を確かめられませんでした。会話を読み直してください。");
          return;
        }
        nextTurn.current = history.nextTurn;
        bubblesRef.current = history.bubbles;
        if (!reveal) {
          revealTexts.current = null;
          activeTurn.current = null;
          setBubbles(history.bubbles);
          setPhase("idle");
          return;
        }
        revealTexts.current = texts;
        startScheduledReveal(revealCancel, setBubbles, texts, sendAt, (index, more) => {
          shownCount.current = index + 1;
          if (!more) {
            revealTexts.current = null;
            activeTurn.current = null;
            setPhase("idle");
          }
        });
      };

      // 別の画面から止められた時の仕上げ。保存結果は履歴の読み直しで確かめて通常へ戻す。
      const finishStopped = async () => {
        clearPendingTurn(turn.characterId, turn);
        setPending(null);
        activeTurn.current = null;
        const stopped = await loadChatHistory(turn.characterId, turn.conversationId, signal).catch(
          () => null,
        );
        if (stopped !== null) {
          nextTurn.current = stopped.nextTurn;
          bubblesRef.current = stopped.bubbles;
          setBubbles(stopped.bubbles);
        }
        setPhase("idle");
      };

      // 出来事が流れ始めたら受付は確実に在る。開き直しの自動再接続に使う印を書く。
      const markAccepted = () => {
        if (turn.accepted === true) return;
        turn.accepted = true;
        // 別のタブが同じ会話へ入れ直した保留を消さんよう、枠が空か自分の受付の時だけ書き戻す。
        const stored = readChatSession(turn.characterId, turn.conversationId).pending;
        if (stored === null || stored.requestId === turn.requestId) {
          writePendingTurn(turn.characterId, turn.conversationId, turn);
        }
        setPending((previous) => (previous?.requestId === turn.requestId ? { ...turn } : previous));
      };

      // 部屋の失敗の出来事は流れの終わりを意味する（配信は error の後に閉じる）。
      // 再試行が効く・効かんは code で分け、効かん物は「入力に戻す」の枠へ。
      const failurePhaseFor = (event: Extract<ChatSseEvent, { type: "error" }>, chunks: number) =>
        event.code !== undefined && REJECT_FAILURE_CODES.has(event.code)
          ? ("rejected" as const)
          : chunks > 0
            ? ("cut_off" as const)
            : ("no_reply" as const);

      // 確定的に終わった出来事の仕上げ。"exit" を返したら追いかけを終わる。
      const applyTerminalEvent = async (
        chunks: Map<number, string>,
        event: ChatSseEvent,
      ): Promise<"exit" | { done: true; sendAt?: number[] } | null> => {
        if (event.type === "done") return { done: true, sendAt: event.sendAt };
        if (event.type === "stopped") {
          await finishStopped();
          return "exit";
        }
        if (event.type === "error") {
          lastFailure.current = "event";
          setPhase(failurePhaseFor(event, chunks.size));
          return "exit";
        }
        return null;
      };

      // 出来事 1 件の処理。"exit" を返したら追いかけを終わる。
      const applyTurnEvent = async (
        chunks: Map<number, string>,
        event: ChatSseEvent,
      ): Promise<"exit" | { done: true; sendAt?: number[] } | null> => {
        markAccepted();
        // 部屋が次の試行を始めたら、前の試行で出ていた塊の控えを捨て直す（S-13b）。
        // 受付が確実に部屋へ届き生成が動き出した印なので、送信待ちは「書いています」へ進む。
        if (event.type === "attempt") {
          chunks.clear();
          shownCount.current = 0;
          setPhase((previous) =>
            previous === "sending" || previous === "resending" ? "writing" : previous,
          );
          return null;
        }
        if (event.type === "chunk") {
          chunks.set(event.seq, event.text);
          chunkSeqs.current = [...chunks.keys()].sort((a, b) => a - b);
          setPhase("arriving");
          return null;
        }
        if (event.type === "token" || event.type === "turn-meta") {
          setPhase((previous) =>
            previous === "sending" || previous === "resending" ? "writing" : previous,
          );
          return null;
        }
        return applyTerminalEvent(chunks, event);
      };

      // follow の例外を失敗の状態へ写す。
      const applyConsumeError = (cause: unknown) => {
        if (cause instanceof ChatDailyLimitError) {
          setDailyLimitMessage(cause.message);
          enterPhase("rejected", "event");
          return;
        }
        if (cause instanceof ChatRequestRejectedError) {
          enterPhase("rejected", "event");
          return;
        }
        if (cause instanceof ChatRoomBusyError) {
          // 別の受付が走っとる。この送信は受理されてへんので、文を入力へ戻して静かに戻す。
          clearPendingTurn(turn.characterId, turn);
          setPending(null);
          setBubbles((previous) => withoutPending(previous, turn));
          setInput((previous) => (previous.trim() ? `${turn.text} ${previous}` : turn.text));
          setPhase("idle");
          return;
        }
        // つながらなかった（POST が届かん・開き直しの GET が切れた）は「送れなかった」へ。
        enterPhase("send_failed", "connect");
      };

      // 出来事の流れを最後まで追いかける。"done" を確かめたら仕上げへ。
      const followLoop = async (chunks: Map<number, string>) => {
        let sendAt: number[] | undefined;
        let done = false;
        // 待ちが長引いている印。繋ぎ直し・長い生成のどちらでも「少し時間がかかっています」へ。
        const slowTimer = setTimeout(() => {
          setPhase((previous) => (isWaitingPhase(previous) ? "slow" : previous));
        }, WAIT_SLOW_MS);
        try {
          for await (const item of followTurn(turn, {
            attach: options.attach ?? turn.accepted === true,
            retry: options.retry === true,
            signal,
          })) {
            if (item.type === "gave_up") {
              enterPhase("no_reply", "connect");
              return;
            }
            if (item.type === "reconnecting") {
              setPhase((previous) => (isWaitingPhase(previous) ? "slow" : previous));
              continue;
            }
            if (item.type !== "event") continue;
            const action = await applyTurnEvent(chunks, item.event);
            if (action === "exit") return;
            if (action !== null) {
              done = true;
              sendAt = action.sendAt;
            }
          }
        } finally {
          clearTimeout(slowTimer);
        }
        if (signal.aborted) return;
        if (!done) {
          enterPhase("no_reply", "connect");
          return;
        }
        await finishDone(chunks, sendAt);
      };

      if (signal.aborted) return;
      setBusy(true);
      setError(null);
      setDailyLimitMessage(null);
      lastFailure.current = null;
      activeTurn.current = turn;
      chunkSeqs.current = [];
      shownCount.current = 0;
      const chunks = new Map<number, string>();
      try {
        await followLoop(chunks);
      } catch (cause) {
        if (signal.aborted) return;
        applyConsumeError(cause);
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    },
    // 補助はこの関数の中で作るので、依存は enterPhase（安定）だけ。
    [enterPhase],
  );

  // 開き直した保留の続け方を、部屋の受付の調べで決める。
  // accepted の印が在る（=受付が確実に在った）時はそのままつなぎ直す。印が無い時は
  // 受付の有無を確かめて、無ければ「送れなかった」の枠からやり直す。
  const resumeSavedPending = useCallback(
    async (turn: PendingTurn, abort: AbortController) => {
      setPhase("sending");
      if (turn.accepted === true) {
        await consume(turn, abort.signal, { attach: true });
        return;
      }
      const state = await readChatTurnState(
        characterId,
        turn.conversationId,
        abort.signal,
        turn.requestId,
      ).catch(() => null);
      if (abort.signal.aborted) return;
      const action = resumeActionFor(state?.request ?? null);
      if (action === "attach") {
        await consume(turn, abort.signal, { attach: true });
        return;
      }
      if (action === "stopped") {
        // 以前に止めた受付。文を入力へ戻して終わる。
        restoreSentText(turn, withoutPending(bubblesRef.current, turn));
        setBusy(false);
        return;
      }
      // request が無い・調べが読めん時は、受付が届かんかった扱いで「送れなかった」へ。
      enterPhase(action, action === "send_failed" ? "connect" : "event");
      setBusy(false);
    },
    [characterId, consume, enterPhase, restoreSentText],
  );

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
  const bubbleControls = (bubble: ChatBubble, latestAssistant: boolean) => {
    const targetConversationId = conversationId.current;
    if (
      bubble.id === undefined ||
      bubble.turn === undefined ||
      bubble.pending ||
      !targetConversationId
    )
      return null;
    const branch = (
      <BranchControls
        embedded
        characterId={characterId}
        conversationId={targetConversationId}
        role={bubble.role}
        turn={bubble.turn}
        busy={busy || pending !== null}
        onChanged={reloadHistory}
        onRewound={setRewoundFrom}
      />
    );
    return (
      <>
        {latestAssistant && branch}
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
        >
          {bubble.role === "user" && branch}
        </MessageActions>
      </>
    );
  };

  // RIT-211: キャラ応答は自動再生設定に関わらず手動再生できる。スイッチは台詞レイヤにだけ
  // 載せ、押したらその台詞だけが読み上がる（描写・心の声は読ませない）。
  const voiceSlotOf = (bubble: ChatBubble) => {
    if (bubble.role !== "assistant" || !bubble.text || bubble.pending) return undefined;
    const bubbleKey = bubble.id ?? `t${bubble.turn ?? 0}`;
    return (layerText: string, layerIndex: number) => {
      const key = `${bubbleKey}:l${layerIndex}`;
      return (
        <VoiceButton
          playing={voiceKey === key}
          busy={false}
          onPlay={() => void playVoice(key, layerText)}
          onStop={stopVoice}
        />
      );
    };
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

  // 「入力に戻す」（部品 C・失敗の枠のどちらからもここへ）。受付の取り下げは部屋へ送り、
  // 作成中で断られた時は入力に戻さずその受付へつなぎ直す（FR-4）。
  const withdrawPending = () => {
    // resending の間も部品 C から呼べるように、follow の busy とは別の印で守る。
    if (!pending || withdrawing) return;
    const turn = pending;
    setWithdrawing(true);
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;

    // 取り下げの応答の画面移し。「保存済み」の時は入力に戻さず返事を出す（FR-4）。
    const finishWithdraw = (result: {
      bubbles: ChatBubble[];
      nextTurn: number;
      storedTurn: StoredTurn | null;
    }) => {
      if (isPendingSaved(turn, result.storedTurn)) {
        clearPendingTurn(turn.characterId, turn);
        setPending(null);
        nextTurn.current = result.nextTurn;
        setBubbles(result.bubbles);
        setPhase("idle");
        return;
      }
      restoreSentText(turn, result.bubbles);
      nextTurn.current = result.nextTurn;
    };

    void (async () => {
      setBusy(true);
      try {
        const result = await withdrawChatTurn(
          turn.characterId,
          turn.conversationId,
          turn.requestId,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        finishWithdraw(result);
      } catch (cause) {
        if (abort.signal.aborted) return;
        if (cause instanceof ChatTurnActiveError) {
          // まだ作成中: 戻すと返事が後から保存されて二重になる。待ちの表示に戻ってつなぎ直す。
          setPhase("writing");
          void consume(turn, abort.signal, { attach: true });
          return;
        }
        if (cause instanceof ChatRequestRejectedError) {
          // 会話もキャラも読めんので、保存されたかは確かめようがない。手元の情報だけで戻す。
          restoreSentText(turn, withoutPending(bubblesRef.current, turn));
          return;
        }
        // 通信切れは取り下げが届いとらん。失敗の枠のままにして出口を残す。
        if (!(cause instanceof ChatConnectionError))
          setError("入力を戻せませんでした。再試行してください。");
      } finally {
        setWithdrawing(false);
        if (!abort.signal.aborted) setBusy(false);
      }
    })();
  };

  // 「もう一度」。失敗の形で中身を変える（FR-2）:
  // - send_failed・つなぎ直し系の no_reply: 同じ受付番号で POST を送り直す。
  // - 失敗の出来事を受けた no_reply・cut_off: 同じ受付番号で retry: true の作り直し。
  // - offline: 入力欄の文で送信をやり直す（オフラインのままなら変わらん）。
  const retryTurn = () => {
    if (phase === "offline") {
      void sendText(input.trim());
      return;
    }
    if (!pending || busy) return;
    const turn = pending;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const regenerate =
      lastFailure.current === "event" && (phase === "no_reply" || phase === "cut_off");
    setPhase("resending");
    void consume(turn, abort.signal, { attach: false, retry: regenerate });
  };

  // 「止める」（部品 D）。止めるの結果は押した時の状態で変わる（FR-9）。
  // 小出しの途中は保留が片付け済みなので、覚えておいた受付を使う。
  const stopTurn = () => {
    const turn = pending ?? activeTurn.current;
    if (!turn || stopping) return;
    const targetConversationId = conversationId.current;
    if (!targetConversationId) return;

    // 保存済み・切り詰めの時の画面移し（履歴を読み直して確かめる）。
    const finishSavedStop = async (outcome: "truncated" | "saved" | "failed") => {
      clearPendingTurn(turn.characterId, turn);
      setPending(null);
      activeTurn.current = null;
      revealTexts.current = null;
      const history = await loadChatHistory(
        turn.characterId,
        targetConversationId,
        new AbortController().signal,
      );
      nextTurn.current = history.nextTurn;
      bubblesRef.current = history.bubbles;
      setBubbles(history.bubbles);
      if (outcome === "truncated") {
        setStoppedNotice(true);
        setPhase("stopped");
      } else if (outcome === "saved") {
        setPhase("idle");
      } else {
        // outcome failed: 届いていた失敗の出来事のとおり（no_reply か rejected）。
        setPhase(dailyLimitMessage !== null ? "rejected" : "no_reply");
      }
    };

    // 小出しの途中で止めの POST が届かんかった時: 残りを直ちに全部出して通常へ（FR-9）。
    const flushReveal = () => {
      const texts = revealTexts.current;
      if (texts === null) return;
      revealCancel.current?.();
      revealCancel.current = null;
      revealTexts.current = null;
      activeTurn.current = null;
      // setBubbles の更新は遅れて走る。中で shownCount.current を読むと、後続の
      // 代入（texts.length）が先に見えて残りの塊が全部落ちるので、ここで確定させる。
      const shown = shownCount.current;
      setBubbles((previous) => {
        let next = previous;
        for (let index = shown; index < texts.length; index += 1) {
          next = revealChunk(next, texts[index], index + 1 < texts.length);
        }
        return next;
      });
      shownCount.current = texts.length;
      setPhase("idle");
    };

    setStopping(true);
    const abort = new AbortController();
    void (async () => {
      try {
        const shownSeq =
          shownCount.current > 0 ? (chunkSeqs.current[shownCount.current - 1] ?? null) : null;
        const result = await stopChatTurn(
          turn.characterId,
          targetConversationId,
          turn.requestId,
          shownSeq,
          abort.signal,
        );
        // 追いかけと小出しを止めてから、結果どおりの画面へ移す。
        controller.current?.abort();
        revealCancel.current?.();
        revealCancel.current = null;
        if (result.outcome === "stopped") {
          // 保存される前（受付が部屋に無い 404 missing も同じ扱い）: 吹き出しを外し文を入力へ。
          restoreSentText(turn, withoutPending(bubblesRef.current, turn));
          return;
        }
        await finishSavedStop(result.outcome);
      } catch (cause) {
        // 止めるの POST が通信で失敗: 待ちの表示のまま「止める」を押せる状態に戻す（FR-9）。
        if (cause instanceof ChatConnectionError) {
          flushReveal();
          return;
        }
        setError(failureMessage(cause));
      } finally {
        setStopping(false);
      }
    })();
  };

  // オフラインの枠は、つながり直した時点で消す（自動では送らない・板 TalkError 7）。
  useEffect(() => {
    if (online && phase === "offline") setPhase("idle");
  }, [online, phase]);

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
        // 確定済みの発言が残る会話へ「初回のひとこと」を足すと、あとから挨拶が混ざる。
        setGreeting((previous) => (history.bubbles.length === 0 ? previous : null));
        bubblesRef.current = history.bubbles;
        setBubbles(
          saved.pending
            ? withPending(history.bubbles, history.nextTurn, saved.pending)
            : history.bubbles,
        );
        if (saved.pending) await resumeSavedPending(saved.pending, abort);
        else {
          setBusy(false);
          setPhase("idle");
        }
        void reloadMarks();
      } catch {
        if (!abort.signal.aborted) {
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
  }, [
    characterId,
    consume,
    initialConversationId,
    newConversationKey,
    reloadMarks,
    resumeSavedPending,
  ]);

  // RIT-203: 候補チップからも同じ送信経路を使えるよう本文だけ受ける形に分ける。
  const sendText = async (text: string) => {
    if (!text || busy || pending) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setError(`${MAX_MESSAGE_LENGTH}字以内で送信してください。入力は保持されています。`);
      return;
    }
    // 板 TalkError 7: オフラインで送信を押した時は POST を出さん。文は入力欄に残す。
    if (!navigator.onLine) {
      setPhase("offline");
      return;
    }
    setStoppedNotice(false);
    const turn: PendingTurn = {
      characterId,
      conversationId: conversationId.current ?? crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      text,
      baseTurn: nextTurn.current,
      accepted: false,
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
    setPhase("sending");
    setBubbles((previous) => withPending(previous, nextTurn.current, turn));
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    // HTTP 200 が返った時点で部屋の受付が確実に在る。開き直しの自動再接続に使う印。
    void (async () => {
      await consume(turn, abort.signal);
      void maybeAutoplay();
    })();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const jumpToMessageId = (messageId: string) => {
    const target = rootRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    target?.scrollIntoView({ block: "center" });
  };

  const keys = bubbleKeys(bubbles);
  // 失敗の状態では空の「作成中」吹き出しは出さん（返事は来てへん）。
  const visibleBubbles = isFailurePhase(phase)
    ? bubbles.filter((bubble) => !(bubble.pending && bubble.role === "assistant"))
    : bubbles;
  const marker = markerText(phase);
  const failure = failureCopy(phase, dailyLimitMessage);
  const failureActions = failureActionsFor(phase, retryTurn, withdrawPending);
  const actionBubbleIndex = actionIndexFor(phase, pending, visibleBubbles);
  const i2iDisabled = busy || imageBusy || pending !== null;
  // 「覚えた：…」は直近の確定した返事の下にだけ出す（RIT-92）。送信中・枝の
  // 古い行・pending 泡には付けん。key に会話+ターンを入れて、返事が進んだ時は
  // リンクごと作り直して問い直させる。index は描画に使う visibleBubbles の番号。
  const lastAssistantIndex = visibleBubbles.reduce(
    (last, bubble, index) =>
      bubble.role === "assistant" && !bubble.pending && bubble.turn !== undefined ? index : last,
    -1,
  );
  const learnedLinkFor = (bubble: ChatBubble, index: number) => {
    if (index !== lastAssistantIndex) return null;
    if (pending !== null || bubble.turn === undefined || conversationId.current === null) {
      return null;
    }
    return (
      <LearnedMemoryLink
        key={`learned:${conversationId.current}:${bubble.turn}`}
        characterId={characterId}
        conversationId={conversationId.current}
        turn={bubble.turn}
      />
    );
  };

  return (
    <div className="v2-chat" data-hide-inner={!showInner} ref={rootRef}>
      <TalkPortrait src={characterAvatar} />
      <header className="v2-talk-header">
        <div className="v2-talk-nameplate">
          <TalkBack slot={backSlot} />
          <span className="v2-talk-lamp" aria-hidden="true" />
          <h1>
            <ChatMessageText text={characterName} />
          </h1>
        </div>
        <div className="v2-talk-header-actions">
          <VoiceCallButton
            state={voiceCall.state}
            remaining={voiceCall.remaining}
            onStart={() => void voiceCall.start()}
            onStop={voiceCall.stop}
          />
          <button type="button" aria-label="メニュー" onClick={() => setMenuOpen(true)}>
            <TalkIcon name="menu" />
          </button>
        </div>
      </header>
      {menuOpen && (
        <TalkSheet title="メニュー" onClose={() => setMenuOpen(false)}>
          <p className="v2-talk-caption">{characterName}との設定</p>
          <ProactiveToggle characterId={characterId} />
          <a className="v2-talk-menu-row" href={`/chat/${encodeURIComponent(characterId)}/memory`}>
            記憶
          </a>
          <GalleryPanel
            characterId={characterId}
            getConversationId={() => conversationId.current}
            onJumpToMessage={jumpToMessage}
            onChanged={() => void reloadAfterGalleryChange()}
          />
        </TalkSheet>
      )}
      <TalkSceneBar
        characterId={characterId}
        conversationId={conversationId.current}
        turn={nextTurn.current}
        busy={busy}
      />
      <ChatMessageLog key={characterId} busy={busy}>
        <GreetingRow name={characterName} avatar={characterAvatar} text={greeting} />
        {visibleBubbles.map((bubble, index) => (
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
            {index === actionBubbleIndex && (
              // 部品 C: 発言の左の操作ボタン。押すと「入力に戻す」と同じ動き。
              <TurnMessageAction onWithdraw={withdrawPending} />
            )}
            <div
              className={`v2-bubble v2-message-turn ${bubble.role} ${bubble.pending ? "pending" : ""}`}
              {...bubbleDataAttrs(bubble)}
            >
              <BubbleMedia bubble={bubble} />
              <I2iSlot
                bubble={bubble}
                open={i2iTarget}
                instruction={i2iInstruction}
                disabled={i2iDisabled}
                onOpen={setI2iTarget}
                onInstruction={setI2iInstruction}
                onSubmit={requestI2i}
              />
              <ChatMessage
                role={bubble.role}
                text={bubble.text}
                characterName={characterName}
                streaming={bubble.pending}
                voiceSlot={voiceSlotOf(bubble)}
              />
              {learnedLinkFor(bubble, index)}
            </div>
            <div className="v2-talk-bubble-controls">
              {bubbleControls(bubble, index === lastAssistantIndex)}
            </div>
          </div>
        ))}
        {marker !== null && <TurnMarker text={marker} icon={phase !== "resending"} />}
        {isWaitingPhase(phase) && <ChatWaiting phase={phase} />}
        {stoppedNotice && <StoppedMarker />}
      </ChatMessageLog>
      <ChatFooter
        trayContent={
          <>
            <section>
              <p className="v2-talk-caption">この会話</p>
              <ChatHeaderControls
                showInner={showInner}
                onToggleInner={() => setShowInner((prev) => !prev)}
              />
            </section>
            <section>
              <p className="v2-talk-caption">場面</p>
              <LedgerPanel
                characterId={characterId}
                getConversationId={() => conversationId.current}
              />
              <BookmarkPanel
                characterId={characterId}
                getConversationId={() => conversationId.current}
                onJump={jumpToMessageId}
              />
            </section>
          </>
        }
        busy={busy}
        imageBusy={imageBusy}
        pending={pending}
        phase={phase}
        error={error}
        failure={failure}
        failureActions={failureActions}
        rewoundFrom={rewoundFrom}
        onRestoreRewound={restoreRewound}
        onWithdraw={withdrawPending}
        onRetry={retryTurn}
        stopping={stopping}
        onStop={stopTurn}
        input={input}
        onInput={setInput}
        onSubmit={send}
        onPick={sendText}
        onImage={requestImage}
        characterId={characterId}
        getConversationId={() => conversationId.current}
        onError={setError}
        paramField={paramField}
      />
    </div>
  );
};
