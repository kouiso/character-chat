import { useEffect, useRef } from "react";

import { AuthenticatedImage } from "@/component/ui/authenticated-image";
import type { ChatMessage } from "@/store/chat-store";

import { OU2 } from "./ouse-tokens";

type Message = ChatMessage;

const READ_SHADOW_SOFT = "0 0 1px rgba(5,3,2,.8), 0 1px 10px rgba(5,3,2,.55)";
const LONG_PRESS_MS = 550;

interface YouMessageProps {
  message: Message;
  // 設計 C-3: 未送達（sendFailed）の発言でのみ有効。タップ再送・長押し削除。
  onRetry?: () => void;
  onDelete?: () => void;
  // 添付画像をタップして拡大表示する
  onImageClick?: () => void;
}

// 未送達の自分の発言（設計 C-3）: 破線＋！バッジで「まだ届いていない」ことを世界観のことばで示す。
// タップで再送、長押しで削除。技術用語（エラー/失敗コード）は出さない。
const FailedYouMessage = ({
  content,
  onRetry,
  onDelete,
}: {
  content: string;
  onRetry?: () => void;
  onDelete?: () => void;
}) => {
  const longPressedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPress = () => {
    longPressedRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      onDelete?.();
    }, LONG_PRESS_MS);
  };
  const finishPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // 長押しで削除済みなら再送しない
    if (!longPressedRef.current) onRetry?.();
    // 打ち消しの印は click 1 回ぶんで使い切る。残すと、pointerdown を伴わん click
    // (キーボード・支援技術・pointercancel を先に撃つ環境)まで飲み込んで、二度と
    // 再送でけへんボタンになる。
    longPressedRef.current = false;
  };
  // touch では pointerup の直後に pointerout/pointerleave が来て、その後で click が来る
  // (Chromium 実測: pointerdown → pointerup → pointerout → pointerleave → click)。
  // 離脱で「長押し済み」を立てると、あらゆるタップが自分で自分を打ち消して再送が
  // 一度も走らん。離脱では長押しタイマーを畳むだけにする。
  const abortLongPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  // pointercancel はスクロール等で操作が奪われた合図。click は来んのが普通やが、
  // 来た時に再送すると「触ってへんのに送られた」になるので抑える。
  const cancelPress = () => {
    abortLongPress();
    longPressedRef.current = true;
  };

  // 押下直後に発言が別経路（自動再送等）で消えても、残ったタイマーが stale な onDelete を呼ばないよう解除する
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div data-testid="message-bubble" className="flex w-full flex-col items-end px-[26px] py-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: OU2.warnBgStrong,
            border: `1px solid ${OU2.warnBorder}`,
            color: OU2.warnText,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
        >
          !
        </span>
        <button
          type="button"
          // aria-label で上書きすると発言本文がスクリーンリーダーに読まれん
          // (「タップで再送」しか聞こえず、何を再送するのか分からない)。
          // 本文を主のアクセシブル名にし、操作説明は末尾へ添える。
          aria-label={`${content}（タップで再送）`}
          onClick={finishPress}
          onPointerDown={startPress}
          onPointerLeave={abortLongPress}
          onPointerCancel={cancelPress}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            maxWidth: "74%",
            padding: "12px 17px",
            borderRadius: "20px 20px 7px 20px",
            background: "rgba(214,169,87,.1)",
            border: `1px dashed ${OU2.warnBorder}`,
            color: OU2.faint,
            fontFamily: '"Zen Maru Gothic", sans-serif',
            fontSize: 14,
            lineHeight: 1.7,
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          {content}
        </button>
        {/* 長押し削除はポインタ操作専用のため、キーボード等でも削除できる独立ボタンを併設する */}
        <button
          type="button"
          aria-label="この発言を削除"
          onClick={() => onDelete?.()}
          style={{
            flex: "0 0 auto",
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "none",
            background: "none",
            color: OU2.faint,
            fontSize: 18,
            lineHeight: 1,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 8,
          marginRight: 2,
          fontFamily: OU2.round,
          fontSize: 11.5,
        }}
      >
        <span style={{ color: OU2.lamp }}>↻ タップで再送</span>
        <span style={{ color: OU2.faint }}>長押しで削除</span>
      </div>
    </div>
  );
};

export const YouMessage = ({ message, onRetry, onDelete, onImageClick }: YouMessageProps) => {
  if (message.sendFailed) {
    return <FailedYouMessage content={message.content} onRetry={onRetry} onDelete={onDelete} />;
  }

  return (
    <div
      data-testid="message-bubble"
      data-message-id={message.id}
      className="flex w-full flex-col items-end px-[26px] py-2"
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          color: OU2.label,
          marginBottom: 6,
        }}
      >
        あなた
      </div>
      <div
        style={{
          maxWidth: "80%",
          padding: "12px 17px",
          borderRadius: "20px 20px 7px 20px",
          background: `linear-gradient(145deg, ${OU2.bubbleGradA}, ${OU2.bubbleGradB})`,
          border: `1px solid ${OU2.bubbleBorder}`,
          color: OU2.text,
          fontSize: 14.5,
          lineHeight: 1.7,
          fontFamily: '"Zen Maru Gothic", sans-serif',
          textShadow: READ_SHADOW_SOFT,
        }}
      >
        <p className="m-0 whitespace-pre-wrap">{message.content}</p>
        {message.imageUrl ? (
          <button
            type="button"
            className="mt-2 block w-full p-0 text-left"
            onClick={onImageClick}
            aria-label="画像を拡大"
            style={{
              border: "none",
              background: "none",
              cursor: "zoom-in",
            }}
          >
            <AuthenticatedImage
              src={message.imageUrl}
              alt=""
              className="max-h-48 rounded-lg object-cover"
              loading="lazy"
            />
          </button>
        ) : null}
      </div>
    </div>
  );
};
