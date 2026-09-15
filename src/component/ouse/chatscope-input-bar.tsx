import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { MessageInput } from "@chatscope/chat-ui-kit-react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";

import { CONTENT_EDITOR_SELECTOR } from "./composer-draft";
import { ImageGenerateButton } from "./input-bar";
import { OU2 } from "./ouse-tokens";

interface ChatscopeInputBarProps {
  onSend: (message: string) => void;
  onImageGenerate: () => void;
  onBegSheetOpen: () => void;
  isLoading: boolean;
  isImageGenerating?: boolean;
  characterName: string;
}

// chatscope の SendButton は aria-hidden な svg だけを持つ無名ボタンで、
// 支援技術に何も読まれん。ライブラリ側にラベルを渡す口が無いので DOM へ付ける。
const SEND_BUTTON_SELECTOR = ".cs-button--send";

// chatscope の MessageInput を既存「燈」デザインに寄せ、画像生成ボタンは長押しシート対応のまま維持する
export const ChatscopeInputBar = ({
  onSend,
  onImageGenerate,
  onBegSheetOpen,
  isLoading,
  isImageGenerating = false,
  characterName,
}: ChatscopeInputBarProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // 下書きの本文を自分でも持つ。コピーは押した瞬間に contenteditable から
  // フォーカスも選択も外れるので、DOM の選択状態やのうて state から読む。
  const [draft, setDraft] = useState("");
  const hasDraft = draft.trim().length > 0;
  const canSend = hasDraft && !isLoading;

  useEffect(() => {
    const editor = wrapperRef.current?.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR);
    if (!editor) return;
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", `${characterName}へのメッセージ入力`);
  }, [characterName]);

  // 送信可否の切り替えでボタンが差し替わるため canSend でも張り直す
  useEffect(() => {
    const sendButton = wrapperRef.current?.querySelector<HTMLElement>(SEND_BUTTON_SELECTOR);
    sendButton?.setAttribute("aria-label", "送信");
  }, [canSend]);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // chatscope は onSend を呼ぶ前に自分の state を空にする。こちらも合わせて畳まんと
      // 空の入力欄に対して送信ボタンが活きたまま残る。
      setDraft("");
      onSend(trimmed);
    },
    [onSend],
  );

  const handleCopyDraft = useCallback(() => {
    void (async () => {
      const copied = await copyText(draft);
      if (copied) toast.success("下書きをコピーしました");
      else toast.error("下書きをコピーでけませんでした");
    })();
  }, [draft]);

  return (
    <div
      className="px-4 pb-[calc(22px+env(safe-area-inset-bottom))]"
      style={{ background: OU2.barBg, borderTop: `1px solid ${OU2.inputBarTopBorder}` }}
    >
      <div
        ref={wrapperRef}
        className="chatscope-ouse-input mx-auto flex min-w-0 max-w-3xl items-center gap-[9px] overflow-hidden rounded-[24px] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--input-focus)]"
        style={
          {
            padding: "10px 18px 10px 16px",
            background: OU2.inputBarBg,
            border: `1px solid ${OU2.inputBarBorder}`,
            "--input-focus": OU2.lamp,
          } as CSSProperties
        }
      >
        <ImageGenerateButton
          isLoading={isLoading}
          isImageGenerating={isImageGenerating}
          onImageGenerate={onImageGenerate}
          onBegSheetOpen={onBegSheetOpen}
        />
        <MessageInput
          placeholder={`${characterName}に話しかける…`}
          onSend={(_html, text) => handleSend(text)}
          onChange={(_html, text) => setDraft(text)}
          // 返事を待っとる間も打てるようにする。ここへ disabled を渡すと chatscope の
          // ContentEditable が contentEditable={false} を描き、25〜45秒のあいだ入力欄が
          // 死んで文字も選択もでけへんくなる（局長 2026-08-17, Android 実機）。
          // 止めるのは送信だけ。
          sendDisabled={!canSend}
          // Enter は chatscope 内部で sendDisabled を見ずに send() を呼ぶ。send() は
          // onSend の前に入力欄を空にするので、待ち中に Enter を押されると本文だけが
          // 消えて何も送られん。待ち中は Enter を改行に戻して send() へ入らせん。
          sendOnReturnDisabled={isLoading}
          sendButton
          attachButton={false}
        />
      </div>
      {(isLoading || hasDraft) && (
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-2 pt-2">
          {isLoading && (
            <span
              className="min-w-0 flex-1 truncate"
              style={{ fontFamily: OU2.round, fontSize: 11, color: OU2.faint }}
            >
              返事を待っています。続けて書けます
            </span>
          )}
          {hasDraft && (
            <button
              type="button"
              onClick={handleCopyDraft}
              aria-label="下書きをコピー"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[14px] px-3"
              style={{
                border: `1px solid ${OU2.hairline}`,
                color: OU2.faint,
                fontFamily: OU2.round,
                fontSize: 11,
              }}
            >
              <Copy size={13} aria-hidden />
              下書きをコピー
            </button>
          )}
        </div>
      )}
    </div>
  );
};
