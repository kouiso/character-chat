import { useMemo, useState, useEffect, type CSSProperties } from "react";

import { AlertCircle, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import { usePacedReveal } from "@/hook/use-paced-reveal";
import type { Character } from "@/lib/api";
import {
  parsePartialXmlResponse,
  parseXmlResponse,
  splitInlineEmphasis,
  stripXmlTags,
  type StructuredResponse,
} from "@/lib/xml-response-parser";
import type { ChatMessage } from "@/store/chat-store";

import { MessageFeedbackSheet, type MessageFeedbackPayload } from "./message-feedback-sheet";
import { OU2 } from "./ouse-tokens";

type Message = ChatMessage;
type LayerType = "scene" | "action" | "dialogue" | "inner" | "narration";

interface HerMessageProps {
  message: Message;
  isStreaming: boolean;
  character?: Character;
  onFeedback?: (rating: "good" | "bad", reason?: string) => void;
  onRegenerate?: () => void;
  isImageGenerating?: boolean;
  feedbackRating?: "good" | "bad";
  variation?: VariationInfo;
  // この発言へのパーマリンクを URL に設定する
  // 添付画像をタップして拡大表示する
  onImageClick?: () => void;
}

interface RevealedPart {
  type: LayerType;
  displayText: string;
  fullText: string;
}

const OUSE_KEYFRAMES_ID = "ouse-keyframes";

if (typeof document !== "undefined" && !document.querySelector(`#${OUSE_KEYFRAMES_ID}`)) {
  const style = document.createElement("style");
  style.id = OUSE_KEYFRAMES_ID;
  style.textContent = `
    @keyframes ptBlink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
    @keyframes ptPulse { 0%{opacity:.25}50%{opacity:1}100%{opacity:.25} }
  `;
  document.head.appendChild(style);
}

const READ_SHADOW = "0 0 1px rgba(5,3,2,.92), 0 1px 12px rgba(5,3,2,.72)";
const READ_SHADOW_SOFT = "0 0 1px rgba(5,3,2,.8), 0 1px 10px rgba(5,3,2,.55)";

const layerStyles: Record<LayerType, CSSProperties> = {
  // scene は本文とは別に SceneDivider（中央寄せの罫線区切り）として描画するため未使用
  scene: {
    fontFamily: '"Zen Maru Gothic", sans-serif',
    fontSize: 10.5,
    lineHeight: 1.7,
    letterSpacing: "0.2em",
    color: OU2.faint,
    textShadow: READ_SHADOW_SOFT,
  },
  // 地の文は本文の 75%（実測 2026-08-17 phase9: 地の文 20,175字 / 台詞 6,903字）。
  // その 75% が一番小さく一番淡いレイヤーに置かれとって、局長の「読むのが疲れる」の実体が
  // これやった。台詞との落差（13.5 対 18）は残しつつ、多数派の側を読める大きさへ上げる。
  // 390px 幅で 15.5px なら 1 行 21 字前後になり、日本語の可読域（20〜30字）へ入る。
  action: {
    fontFamily: OU2.serif,
    fontSize: 15.5,
    lineHeight: 1.95,
    color: "rgba(243,234,217,0.93)",
    textShadow: READ_SHADOW,
  },
  // 台詞と地の文の差が「18px か 15.5px か」だけやと、どこからが本人の言葉なのかが
  // 読みながら分からん（局長 2026-08-17）。モデルは <dialogue> へ地の文を入れる方にも
  // 同じだけ雑なので、名前を貼って「これは本人の発言」と言い切ることはできん。
  // 代わりに器の形で示す: 台詞だけが左罫線を持ち、内側へ寄り、わずかに明るい帯を敷く。
  // 罫線は inner（心の声）と同じ語彙で、色と太さで層を分ける。
  dialogue: {
    fontFamily: OU2.serif,
    fontSize: 18,
    lineHeight: 1.85,
    color: OU2.text,
    textShadow: READ_SHADOW,
    borderLeft: `2px solid ${OU2.accent}`,
    paddingLeft: 14,
    paddingTop: 2,
    paddingBottom: 3,
    background: `linear-gradient(90deg, rgba(240,220,174,0.09), rgba(240,220,174,0) 62%)`,
    borderRadius: 3,
  },
  // 気持ちは毎ターン 80〜120 字で生成されとったのに、描画から除外されとった
  // （可視文字数に数えん設計の名残）。見えんかったせいで気持ちが台詞側へ滲み、
  // 「え、そんなこと言う？」という発言が出とった（局長 2026-08-17）。3 層目として出す。
  //
  // 3 層は罫線で見分ける: 地の文=罫線なし / 台詞=2px の accent / 気持ち=1px の細い茶。
  // 斜体は使わん。明朝へ掛かると偽斜体になって「歪んだ字」に見える（圏点と同じ理由）。
  inner: {
    fontFamily: OU2.serif,
    fontSize: 14.5,
    lineHeight: 1.95,
    color: OU2.innerMono,
    borderLeft: `1px solid ${OU2.innerRule}`,
    paddingLeft: 14,
    textShadow: READ_SHADOW_SOFT,
  },
  narration: {
    fontFamily: OU2.serif,
    fontSize: 15,
    lineHeight: 2.05,
    color: OU2.narration,
    textShadow: READ_SHADOW_SOFT,
  },
};

// 案A「燈」: シーン導入は左詰めの地の文ではなく、罫線に挟まれた中央寄せの見出しとして表示する
const SceneDivider = ({ label }: { label: string }) => (
  <div style={{ textAlign: "center", margin: "6px 0 22px" }}>
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        color: OU2.chrome,
      }}
    >
      <span style={{ width: 34, height: 1, background: OU2.chromeDim }} />
      <span
        style={{
          fontFamily: OU2.serif,
          fontSize: 12.5,
          letterSpacing: "0.26em",
          whiteSpace: "pre-wrap",
        }}
      >
        {label}
      </span>
      <span style={{ width: 34, height: 1, background: OU2.chromeDim }} />
    </div>
  </div>
);

const buildDisplayResponse = (
  content: string,
  isStreaming: boolean,
): Partial<StructuredResponse> => {
  if (isStreaming) return parsePartialXmlResponse(content);
  const parsed = parseXmlResponse(content);
  if (parsed) return parsed;
  return { dialogue: stripXmlTags(content) || content };
};

const PCaret = () => (
  <span
    style={{
      display: "inline-block",
      width: 2,
      height: 14,
      background: OU2.lamp,
      boxShadow: `0 0 6px ${OU2.lamp}`,
      marginLeft: 2,
      verticalAlign: "middle",
      animation: "ptBlink 0.9s steps(2) infinite",
    }}
  />
);

interface MessageBodyProps {
  parts: RevealedPart[];
  isRevealing: boolean;
  lastPartWithTextIdx: number;
}

// 本文中に地の文のまま残った *強調* を斜体レイヤーとしてインライン描画する
// （<inner>タグを使わずモデルが直接 *asterisk* を書くフォールバック応答向け）。
// inner レイヤーは既に専用の斜体/淡色スタイルを持つため、色は上書きせず継承する
// （二重にasteriskで囲まれても意図した色が消えないように）。それ以外のレイヤーだけ
// OU2.dim で地の文寄りの淡色にする
// 三点リーダーが行の中央に浮いて読みづらい（局長 2026-08-17「このてんてんてん、ちょっと
// 読みずらい。下に来る…の方がいいのでは？」）。Noto Serif JP の U+2026 は日本語の作法どおり
// 縦中央に置かれるが、明朝の細い字面と 1.95 の行送りだと、点が本文から浮いて見える。
// 文字は変えずに、連続する「…」だけを少し下げてベースライン寄りにする。
const ELLIPSIS_RUN = /(…+)/u;
const ELLIPSIS_DROP = "0.18em";

// position:relative + top は見た目の位置だけを動かすペイント側のオフセットで、テキスト選択の
// 矩形計算に正しく反映されないブラウザがある。選択がこの範囲へ掛かると、ネイティブの
// コピー/ペーストメニューが実際の文字より上にズレて出る(D13: 局長「コピペのメニューが
// 上にありすぎる」)。vertical-align はレイアウトそのものを動かすので選択矩形も追従する。
const withLoweredEllipsis = (text: string, keyPrefix: string): React.ReactNode[] =>
  text.split(ELLIPSIS_RUN).map((chunk, index) =>
    ELLIPSIS_RUN.test(chunk) && chunk.startsWith("…") ? (
      <span key={`${keyPrefix}-e${index}`} style={{ verticalAlign: `-${ELLIPSIS_DROP}` }}>
        {chunk}
      </span>
    ) : (
      chunk
    ),
  );

const InlineText = ({ text, dimColor }: { text: string; dimColor?: string }) => (
  <>
    {splitInlineEmphasis(text).map((segment, index) => {
      // ストリーミング中はテキストが伸びてセグメント境界が動くため、位置(index)だけでなく
      // 内容も含めた安定キーにして em/span の取り違え・不要な再マウントを防ぐ
      const key = `${index}:${segment.emphasis ? "em" : "t"}:${segment.text}`;
      return segment.emphasis ? (
        // 日本語の強調は圏点。斜体は欧文の作法で、明朝に掛けると偽斜体になって
        // 「強調」やのうて「歪んだ字」に見える。圏点なら漫画・小説と同じ読み味になる。
        <em
          key={key}
          style={{
            fontStyle: "normal",
            fontWeight: 500,
            textEmphasis: "filled dot",
            WebkitTextEmphasis: "filled dot",
            textEmphasisPosition: "over right",
            WebkitTextEmphasisPosition: "over right",
            ...(dimColor ? { color: dimColor } : {}),
          }}
        >
          {segment.text}
        </em>
      ) : (
        <span key={key}>{withLoweredEllipsis(segment.text, key)}</span>
      );
    })}
  </>
);

// 案A「燈」のレイアウト設計に基づき、シーン導入（scene）以外の本文レイヤーのみを描画するため。
// buildParts は fullText だけあるレイヤー（ストリーミングでまだ displayText が空）も残すため、
// ここで displayText 空の要素を除外しないと marginTop 付きの空divが積まれてしまう
// 1ブロックの中の段落は改行しか持っとらんかったので、9段落の<action>が一枚の板に見えた
// （実測 2026-08-17 phase9 さくら t9: action 9段落 + dialogue 16段落）。ブロック間の 12px は
// 効くのに段落間はゼロで、そこが「読みづらいけど言語化しにくい」の実体やった。
// 段落は font size 相対で空ける。ブロック間(12px)より狭くして、段落 < ブロックの階層を残す。
const splitParagraphs = (text: string): string[] =>
  text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

const MessageBody = ({ parts, isRevealing, lastPartWithTextIdx }: MessageBodyProps) => {
  const lastPartWithText = parts[lastPartWithTextIdx];
  return (
    <>
      {parts
        .filter((part) => part.displayText)
        .map((part, index) => {
          const paragraphs = splitParagraphs(part.displayText);
          return (
            <div
              key={`${part.type}-${index}`}
              style={{ marginTop: index > 0 ? 12 : 0, ...layerStyles[part.type] }}
            >
              {paragraphs.map((paragraph, paragraphIndex) => (
                <p
                  key={`${paragraphIndex}:${paragraph.slice(0, 12)}`}
                  className="m-0 whitespace-pre-wrap"
                  style={{ marginTop: paragraphIndex > 0 ? "0.7em" : 0 }}
                >
                  <InlineText text={paragraph} dimColor={OU2.dim} />
                  {isRevealing &&
                  part === lastPartWithText &&
                  paragraphIndex === paragraphs.length - 1 ? (
                    <PCaret />
                  ) : null}
                </p>
              ))}
            </div>
          );
        })}
    </>
  );
};

// 案A「燈」L78,98,109: 38px円アバター＋（話者名＋本文）の縦積みを横並びにする
const SpeakerAvatar = ({ avatarUrl, name }: { avatarUrl?: string | null; name: string }) => {
  const initial = name.trim()[0] ?? "?";
  const letterFallback = (
    <span className="text-[14px]" style={{ color: OU2.nameTag, fontFamily: OU2.serif }}>
      {initial}
    </span>
  );
  return (
    <div
      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ border: `1px solid ${OU2.avatarRingMsg}` }}
    >
      {avatarUrl ? (
        <AuthenticatedImage
          src={avatarUrl}
          alt={name}
          className="h-full w-full object-cover"
          style={{ objectPosition: "50% 20%" }}
          fallback={letterFallback}
        />
      ) : (
        letterFallback
      )}
    </div>
  );
};

const SpeakerName = ({
  name,
  avatarUrl,
  children,
}: {
  name: string;
  avatarUrl?: string | null;
  children: React.ReactNode;
}) => (
  <div style={{ display: "flex", gap: 12 }}>
    <SpeakerAvatar avatarUrl={avatarUrl} name={name} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontFamily: OU2.serif,
          fontSize: 13,
          color: OU2.nameTag,
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {name}
      </div>
      {children}
    </div>
  </div>
);

const RememberChip = ({ text }: { text: string }) => (
  <div
    style={{
      marginTop: 11,
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      padding: "6px 11px",
      borderRadius: 13,
      border: `1px dashed ${OU2.rememberBorder}`,
      color: OU2.rememberText,
      fontSize: 11.5,
      maxWidth: "100%",
      wordBreak: "break-word",
    }}
  >
    <span style={{ fontSize: 10 }}>◆</span>
    覚えておく：{text}
  </div>
);

const WAIT_TICK_MS = 1000;

interface WaitingIndicatorProps {
  // ターンを始めた実時刻（handleSend の sentAt）。無いときだけ mount 時刻で代替する。
  startedAt?: number;
  // ストリームから届いた生の文字数。この表示が出とる間は層として parse でける本文が
  // まだ 0 なので、本文の可視文字数では常に 0 になる。動いとる証拠になるのは生の長さだけ。
  receivedChars: number;
}

// 返事待ちの合図。文言が静止したままやと、遅いターンで生きとるか分からん
// （局長 2026-08-17「本当にちゃんとレスポンスが帰ってくるのか不安になる」）。
// 出すのは実際に起きたことだけ——経過秒と、届いた生の文字数。タイマーで伸びる進捗バーは
// 何も届いてへん時にも動いてまうので置かん。
const WaitingIndicator = ({ startedAt, receivedChars }: WaitingIndicatorProps) => {
  // startedAt が無い（履歴由来など createdAt を持たん）時だけ mount 時刻で代替する。
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), WAIT_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = Math.max(0, Math.floor((now - (startedAt ?? mountedAt)) / 1000));
  const hasArrived = receivedChars > 0;

  return (
    <div
      style={{
        display: "inline-block",
        border: "1px dashed rgba(243,234,217,0.18)",
        borderRadius: 6,
        padding: "7px 14px",
        color: OU2.faint,
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: 11,
        letterSpacing: "0.18em",
        animation: "ptPulse 1.8s ease-in-out infinite",
      }}
    >
      {hasArrived ? "ことばが届きはじめた" : "ことばを探している"}…
      <span style={{ marginLeft: 8, color: OU2.ghost, letterSpacing: "0.08em" }}>
        {elapsedSeconds}秒{hasArrived ? ` ・ ${receivedChars}字` : ""}
      </span>
    </div>
  );
};

/**
 * サーバ側が返事を作り直しとる間に出す印。
 * この間は本文を消さずに旧本文を出したままにしとるので、何も出さんと止まって見える。
 */
interface RewritingIndicatorProps {
  isRegenerating: boolean | undefined;
  hasBody: boolean;
  isStreaming: boolean;
}

// isRegenerating は「撮り直しを経て出来た返事」の印としても立つ（onComplete が渡す）。
// 流れ終わった吹き出しへ出すと、完成した返事に脈打つ表示が貼り付いたままになる。
const RewritingIndicator = ({ isRegenerating, hasBody, isStreaming }: RewritingIndicatorProps) =>
  !isStreaming || !isRegenerating || !hasBody ? null : (
    <div
      style={{
        marginTop: 10,
        display: "inline-block",
        color: OU2.ghost,
        fontFamily: '"Zen Maru Gothic", sans-serif',
        fontSize: 11,
        letterSpacing: "0.18em",
        animation: "ptPulse 1.8s ease-in-out infinite",
      }}
    >
      ことばを選びなおしている…
    </div>
  );

// 会話バリエーション切替（‹ n / m ›）。regenerate で複数案を保持する将来配線用。
// 現状 consumer から総数が渡らないため total > 1 のときだけ表示する。
export interface VariationInfo {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

interface HerActionRowProps {
  isStreaming: boolean;
  onFeedback?: (rating: "good" | "bad", reason?: string) => void;
  onRegenerate?: () => void;
  feedbackRating?: "good" | "bad";
  variation?: VariationInfo;
  // ▽（イマイチ）押下でフィードバックシートを開く
  onBad: () => void;
  // ⧉ コピー。design の並び（♡ ▽ ⧉ ↻）に合わせ good/bad と再生成の間に差し込む
  copySlot?: React.ReactNode;
  // 読み上げなど既存の付随操作。design には無いので末尾へ寄せる
  trailingSlot?: React.ReactNode;
}

// 好み2つ+コピー+再生成(アイコン+文字)+パーマリンク+読み上げが全部揃うと
// gap:16 の合計最小幅が 390px 幅のスマホを超える。祖先の .ou-message-list が
// overflow-x:hidden(ouse.css) のため、折り返しもスクロールも無いとボタンが
// クリップされて掴めなくなる。ouse-composer.tsx のチップ行と同じ横スクロールで逃がす。
const actionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  color: OU2.label,
  overflowX: "auto",
  scrollbarWidth: "none",
};

const glyphButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 44,
  minHeight: 44,
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  lineHeight: 1,
  transition: "color 0.2s",
};

interface HerFeedbackButtonsProps {
  onFeedback: (rating: "good" | "bad", reason?: string) => void;
  feedbackRating?: "good" | "bad";
  onBad: () => void;
}

const HerFeedbackButtons = ({ onFeedback, feedbackRating, onBad }: HerFeedbackButtonsProps) => (
  <>
    <button
      type="button"
      onClick={() => onFeedback("good")}
      aria-pressed={feedbackRating === "good"}
      aria-label="good"
      title="こういう返しが好き"
      style={{
        ...glyphButtonStyle,
        // アクティブ時はゴールドで点灯する。
        color: feedbackRating === "good" ? OU2.lamp : OU2.faint,
      }}
    >
      <ThumbsUp size={15} />
    </button>
    <button
      type="button"
      onClick={onBad}
      aria-pressed={feedbackRating === "bad"}
      aria-label="イマイチ"
      style={{
        ...glyphButtonStyle,
        color: feedbackRating === "bad" ? OU2.rose : OU2.faint,
      }}
    >
      <ThumbsDown size={15} />
    </button>
  </>
);

const VariationSwitcher = ({ index, total, onPrev, onNext }: VariationInfo) => (
  <span
    style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: OU2.label }}
  >
    <button
      type="button"
      onClick={onPrev}
      aria-label="前の案"
      style={{ ...glyphButtonStyle, fontSize: 14, color: OU2.label }}
    >
      ‹
    </button>
    <span style={{ letterSpacing: "0.06em" }}>
      {index} / {total}
    </span>
    <button
      type="button"
      onClick={onNext}
      aria-label="次の案"
      style={{ ...glyphButtonStyle, fontSize: 14, color: OU2.label }}
    >
      ›
    </button>
  </span>
);

const HerActionRow = ({
  isStreaming,
  onFeedback,
  onRegenerate,
  feedbackRating,
  variation,
  onBad,
  copySlot,
  trailingSlot,
}: HerActionRowProps) => {
  const showVariation = !isStreaming && variation && variation.total > 1;
  const showFeedback = !isStreaming && onFeedback;
  const showRegenerate = !isStreaming && onRegenerate;

  return (
    <>
      <div className="[&::-webkit-scrollbar]:hidden" style={actionRowStyle}>
        {showFeedback ? (
          <HerFeedbackButtons
            onFeedback={onFeedback}
            feedbackRating={feedbackRating}
            onBad={onBad}
          />
        ) : null}
        {copySlot}
        {showRegenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            aria-label="再生成"
            style={{
              ...glyphButtonStyle,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: OU2.label,
            }}
          >
            <span style={{ fontSize: 14 }}>↻</span>再生成
          </button>
        ) : null}
        {showVariation ? <VariationSwitcher {...variation} /> : null}
        {trailingSlot}
      </div>
      {showFeedback ? (
        <div style={{ fontSize: 10.5, color: OU2.faint, marginTop: 8 }}>
          ♡は「こういう返しが好き」として学習
        </div>
      ) : null}
    </>
  );
};

// action/dialogueが交互に複数出た場合、モデルが書いた地の文→台詞→地の文…の順序を
// 画面でもそのまま保つため、出現順の blocks があればそれで本文パートを組み立てる。
// blocks はストリーミング中の部分パース（parsePartialXmlResponse）には無いため、
// 受信中だけは従来通り種別ごとの単一表示にフォールバックする。
const buildParts = (
  parsed: Partial<StructuredResponse>,
  revealed: Partial<StructuredResponse>,
): RevealedPart[] => {
  if (parsed.blocks && parsed.blocks.length > 0) {
    const scenePart: RevealedPart[] = parsed.scene
      ? [{ type: "scene", displayText: revealed.scene ?? "", fullText: parsed.scene }]
      : [];
    const bodyBlocks: RevealedPart[] = parsed.blocks.map((block) => ({
      type: block.type,
      displayText: block.text,
      fullText: block.text,
    }));
    const innerPart: RevealedPart[] = parsed.inner
      ? [{ type: "inner", displayText: revealed.inner ?? "", fullText: parsed.inner }]
      : [];
    const narrationPart: RevealedPart[] = parsed.narration
      ? [{ type: "narration", displayText: revealed.narration ?? "", fullText: parsed.narration }]
      : [];
    return [...scenePart, ...bodyBlocks, ...innerPart, ...narrationPart];
  }
  return (["scene", "action", "dialogue", "inner", "narration"] as const)
    .map((type) => ({
      type,
      displayText: revealed[type] ?? "",
      fullText: parsed[type] ?? "",
    }))
    .filter((part) => part.fullText || part.displayText);
};

// シーン導入を中央寄せの見出し（SceneDivider）として本文とは異なるスタイルで最上部に描画するため
const splitSceneAndBody = (parts: RevealedPart[]) => ({
  sceneParts: parts.filter((part) => part.type === "scene" && part.displayText),
  bodyParts: parts.filter((part) => part.type !== "scene"),
});

const findLastIndexWithText = (parts: RevealedPart[]): number =>
  parts.reduce((acc, part, index) => (part.displayText ? index : acc), -1);

const getRememberEntries = (parsed: Partial<StructuredResponse>) => parsed.remember ?? [];

const getMessageImageAlt = (character?: Character): string =>
  `${character?.name ?? "相手"}からの写真`;

interface HerMessageBodyAreaProps {
  character?: Character;
  bodyParts: RevealedPart[];
  isRevealing: boolean;
  isStreaming: boolean;
  lastPartWithTextIdx: number;
  remember: string[];
}

// 話者名ラベル表示可否の分岐だけを切り出し、呼び出し側の複雑度を下げる
const HerMessageBodyArea = ({
  character,
  bodyParts,
  isRevealing,
  isStreaming,
  lastPartWithTextIdx,
  remember,
}: HerMessageBodyAreaProps) => {
  const body = (
    <MessageBody
      parts={bodyParts}
      isRevealing={isRevealing}
      lastPartWithTextIdx={lastPartWithTextIdx}
    />
  );
  const showName = Boolean(character?.name) && bodyParts.length > 0;
  const rememberChips = !isStreaming
    ? remember.map((text, index) => <RememberChip key={`${index}:${text}`} text={text} />)
    : null;
  if (showName && character) {
    return (
      <SpeakerName name={character.name} avatarUrl={character.avatar}>
        {body}
        {rememberChips}
      </SpeakerName>
    );
  }
  return (
    <>
      {body}
      {rememberChips}
    </>
  );
};

const ImageGeneratingCard = () => (
  <div
    className="mt-3 flex min-h-[160px] items-center justify-center"
    style={{
      borderRadius: 18,
      border: `1px solid ${OU2.imageFrameBorder}`,
      background: OU2.veil,
      color: OU2.dim,
      fontFamily: OU2.round,
      fontSize: 13,
      gap: 10,
    }}
  >
    <Loader2 size={18} className="animate-spin" style={{ color: OU2.lamp }} />
    <span>画像を生成中…</span>
  </div>
);

export const HerMessage = ({
  message,
  isStreaming,
  character,
  onFeedback,
  onRegenerate,
  isImageGenerating = false,
  feedbackRating,
  variation,
  onImageClick,
}: HerMessageProps) => {
  const [feedbackSheetOpen, setFeedbackSheetOpen] = useState(false);

  // Submit bad feedback from the sheet, keeping optional free-text reasons and rewrite requests.
  const handleFeedbackSubmit = ({ reason, rewrite }: MessageFeedbackPayload) => {
    onFeedback?.("bad", reason?.trim() || undefined);
    if (rewrite) onRegenerate?.();
  };

  const parsed = useMemo(
    () => buildDisplayResponse(message.content, isStreaming),
    [isStreaming, message.content],
  );
  const revealed = usePacedReveal(parsed, isStreaming);
  const parts = buildParts(parsed, revealed);
  const isRevealing = isStreaming && !revealed.isComplete;
  const { sceneParts, bodyParts } = splitSceneAndBody(parts);
  const lastPartWithTextIdx = findLastIndexWithText(bodyParts);

  return (
    <div
      data-testid="message-bubble"
      data-message-id={message.id}
      // 生成途中の吹き出しを「未完成」として支援技術へ伝える。読み上げ自体は
      // ou-message-list のライブリージョンが確定後に一度だけ行う。
      aria-busy={isStreaming || isImageGenerating}
      className="w-full px-[26px] py-4"
    >
      {sceneParts.map((part) => (
        <SceneDivider key={part.type} label={part.displayText} />
      ))}
      <HerMessageBodyArea
        character={character}
        bodyParts={bodyParts}
        isRevealing={isRevealing}
        isStreaming={isStreaming}
        lastPartWithTextIdx={lastPartWithTextIdx}
        remember={getRememberEntries(parsed)}
      />
      {isStreaming && parts.length === 0 && (
        <WaitingIndicator startedAt={message.createdAt} receivedChars={message.content.length} />
      )}
      <RewritingIndicator
        isRegenerating={message.isRegenerating}
        hasBody={parts.length > 0}
        isStreaming={isStreaming}
      />
      {message.imageUrl ? (
        <button
          type="button"
          className="mt-3 block w-full overflow-hidden p-0"
          onClick={onImageClick}
          aria-label="画像を拡大"
          style={{
            borderRadius: 18,
            border: `1px solid ${OU2.imageFrameBorder}`,
            boxShadow: "0 14px 34px -18px rgba(0,0,0,.7)",
            background: "none",
            cursor: "zoom-in",
            textAlign: "left",
          }}
        >
          <AuthenticatedImage
            src={message.imageUrl}
            alt={getMessageImageAlt(character)}
            className="block h-[240px] w-full object-cover"
            style={{ objectPosition: "50% 14%" }}
            loading="lazy"
            fallback={
              <div
                className="flex min-h-[240px] items-center justify-center"
                style={{ color: OU2.faint, fontSize: 12 }}
              >
                画像を表示できません
              </div>
            }
          />
        </button>
      ) : isImageGenerating ? (
        <ImageGeneratingCard />
      ) : null}

      {message.error && onRegenerate ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid oklch(0.72 0.16 14 / 0.4)",
            background: "oklch(0.72 0.16 14 / 0.08)",
            color: OU2.dim,
            fontFamily: '"Zen Maru Gothic", sans-serif',
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          <AlertCircle size={13} color="oklch(0.72 0.16 14)" />
          <span>送信に失敗しました</span>
          {/* 回線が悪い時にだけ出る復帰導線なので、当たりを 44px 確保する。
              ::before は描画にも layout にも出ず、赤いピルの見た目は変わらない。 */}
          <button
            type="button"
            onClick={onRegenerate}
            className="relative before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
            style={{
              border: "none",
              background: "none",
              color: OU2.lamp,
              cursor: "pointer",
              padding: "2px 4px",
              font: "inherit",
            }}
          >
            再試行
          </button>
        </div>
      ) : null}
      <div style={{ marginTop: 12 }}>
        {/* 局長判断で YAGNI 撤去（2026-08-19）。チップ列（2026-08-17）と同じ扱い。
            読んで続けるのに要るのは「もう一回書かせる」だけで、good / イマイチ /
            コピー / リンク / 読み上げは画面から外す。受け口（onFeedback・onPermalink・
            HerCopyButton・HerMessageTrailingActions）は残してあるので、要る時に戻せる。 */}
        <HerActionRow
          isStreaming={isStreaming}
          onRegenerate={onRegenerate}
          feedbackRating={feedbackRating}
          variation={variation}
          onBad={() => setFeedbackSheetOpen(true)}
        />
      </div>
      <MessageFeedbackSheet
        open={feedbackSheetOpen}
        onOpenChange={setFeedbackSheetOpen}
        onSubmit={handleFeedbackSubmit}
      />
    </div>
  );
};
