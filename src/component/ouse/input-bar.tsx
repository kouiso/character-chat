import { useRef } from "react";
import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";

import { Loader2 } from "lucide-react";

import { OU2 } from "./ouse-tokens";

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onImageGenerate: () => void;
  onBegSheetOpen?: () => void;
  isLoading: boolean;
  isImageGenerating?: boolean;
  characterName: string;
}

interface ImageGenerateButtonProps {
  isLoading: boolean;
  isImageGenerating: boolean;
  onImageGenerate: () => void;
  onBegSheetOpen?: () => void;
}

export const ImageGenerateButton = ({
  isLoading,
  isImageGenerating,
  onImageGenerate,
  onBegSheetOpen,
}: ImageGenerateButtonProps) => {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPressTimer = () => {
    if (!pressTimer.current) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const handlePointerDown = () => {
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      onBegSheetOpen?.();
    }, 300);
  };

  const handlePointerUp = () => {
    if (!pressTimer.current) return;
    clearPressTimer();
    onImageGenerate();
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={clearPressTimer}
      onPointerLeave={clearPressTimer}
      disabled={isLoading || isImageGenerating}
      title={isImageGenerating ? "画像生成中" : "画像生成"}
      aria-label={isImageGenerating ? "画像生成中" : "画像生成"}
      className="relative flex h-11 shrink-0 items-center gap-[5px] rounded-[14px] font-semibold transition-colors duration-200 ease-[cubic-bezier(.32,.72,.27,1)] disabled:opacity-40"
      style={{
        padding: "8px 11px",
        border: `1px solid ${OU2.pillBorder}`,
        color: OU2.pillText,
        fontSize: 12,
      }}
    >
      {isImageGenerating ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <span aria-hidden style={{ fontSize: 12 }}>
          ✦
        </span>
      )}
      {isImageGenerating ? "生成中…" : "画像"}
    </button>
  );
};

export const InputBar = ({
  value,
  onChange,
  onSend,
  onImageGenerate,
  onBegSheetOpen,
  isLoading,
  isImageGenerating = false,
  characterName,
}: InputBarProps) => {
  const hasText = value.trim().length > 0;

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
    const el = event.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <>
      <div
        className="px-4 pb-[calc(22px+env(safe-area-inset-bottom))]"
        style={{ background: OU2.barBg, borderTop: `1px solid ${OU2.inputBarTopBorder}` }}
      >
        <div
          className="mx-auto flex min-w-0 max-w-3xl items-center gap-[9px] overflow-hidden rounded-[24px] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--input-focus)]"
          style={
            {
              padding: "10px 18px 10px 16px",
              background: OU2.inputBarBg,
              border: `1px solid ${OU2.inputBarBorder}`,
              "--input-focus": OU2.lamp,
            } as CSSProperties
          }
        >
          <textarea
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={`${characterName}に話しかける…`}
            aria-label={`${characterName}へのメッセージ入力`}
            rows={1}
            disabled={isLoading}
            className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2 font-sans-ui text-[14px] leading-[1.75] text-[var(--text)] outline-none placeholder:text-[var(--input-placeholder)] disabled:opacity-60"
            style={{ "--input-placeholder": OU2.inputPlaceholder } as CSSProperties}
          />
          <ImageGenerateButton
            isLoading={isLoading}
            isImageGenerating={isImageGenerating}
            onImageGenerate={onImageGenerate}
            onBegSheetOpen={onBegSheetOpen}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={isLoading || !hasText}
            data-testid="send-button"
            aria-label="送信"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: hasText
                ? `linear-gradient(145deg, ${OU2.sendGradA}, ${OU2.sendGradB})`
                : "transparent",
              border: hasText ? "none" : "1px solid rgba(243,234,217,0.28)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.2s",
              color: hasText && !isLoading ? OU2.sendInk : undefined,
            }}
            className="relative shrink-0 disabled:text-[rgba(243,234,217,0.35)] disabled:opacity-70"
          >
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
              ➤
            </span>
          </button>
        </div>
      </div>
    </>
  );
};
