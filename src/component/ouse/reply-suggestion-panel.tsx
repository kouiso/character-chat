import type { CSSProperties } from "react";

import { Loader2, RefreshCw, X } from "lucide-react";

import { OU2 } from "./ouse-tokens";

export type ReplySuggestionStatus = "loading" | "ready" | "error";

interface ReplySuggestionPanelProps {
  status: ReplySuggestionStatus;
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  onRegenerate: () => void;
  onClose: () => void;
}

const rowStyle: CSSProperties = {
  padding: "11px 14px",
  borderRadius: 16,
  border: `1px solid ${OU2.chipBorder}`,
  background: OU2.chipBg,
  color: OU2.chipText,
};

const toolButtonClass =
  "inline-flex items-center gap-1 rounded-[12px] px-2.5 py-1.5 font-sans-ui text-[11px] transition-colors duration-200 ease-[cubic-bezier(.32,.72,.27,1)] disabled:cursor-default disabled:opacity-50";

const ReplySuggestionBody = ({
  status,
  suggestions,
  onSelect,
  onRegenerate,
}: Omit<ReplySuggestionPanelProps, "onClose">) => {
  if (status === "loading") {
    return (
      <div
        className="flex items-center gap-2 px-1 py-3 font-round text-[12px]"
        style={{ color: OU2.faint }}
      >
        <Loader2 size={14} className="animate-spin" />
        言いかたを探しとる…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="font-round text-[12px]" style={{ color: OU2.warnText }}>
          候補が出せんかった。
        </span>
        <button
          type="button"
          onClick={onRegenerate}
          className={toolButtonClass}
          style={{ border: `1px solid ${OU2.warnBorder}`, color: OU2.warnText }}
        >
          もう一度
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[7px]">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="w-full text-left font-sans-ui text-[13px] leading-[1.7] transition-colors duration-200 ease-[cubic-bezier(.32,.72,.27,1)]"
          style={rowStyle}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
};

// 入力欄の上に出す返信候補。押しても送らん——入力欄へ入れて、直してから自分で送る。
export const ReplySuggestionPanel = ({
  status,
  suggestions,
  onSelect,
  onRegenerate,
  onClose,
}: ReplySuggestionPanelProps) => (
  <div
    className="border-t px-4 pt-[10px]"
    style={{ background: OU2.barBg, borderColor: OU2.inputBarTopBorder }}
  >
    <section className="mx-auto max-w-3xl pb-[9px]" aria-label="返信の候補">
      <div className="mb-[7px] flex items-center justify-between gap-2">
        <span
          className="font-round text-[10.5px] tracking-[0.08em]"
          style={{ color: OU2.labelMuted }}
        >
          押すと入力欄に入る。送信はまだせん。
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={status === "loading"}
            className={toolButtonClass}
            style={{ color: OU2.headerAction }}
          >
            <RefreshCw size={12} aria-hidden />
            出し直す
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="返信の候補を閉じる"
            className={toolButtonClass}
            style={{ color: OU2.label }}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </div>
      <ReplySuggestionBody
        status={status}
        suggestions={suggestions}
        onSelect={onSelect}
        onRegenerate={onRegenerate}
      />
    </section>
  </div>
);
