import type { CSSProperties } from "react";

import { Lightbulb } from "lucide-react";

import { OU2 } from "./ouse-tokens";

// 続き / 行動 / 本音 / 急展開 / 覚えて / セリフを渡す のチップは局長判断で YAGNI 撤去
// （2026-08-17）。say/do と長さの傾きは別物なので残す。
interface ChipsPanelProps {
  sayDoMode: "say" | "do" | null;
  onSayDoChange: (mode: "say" | "do" | null) => void;
  responseLength: string;
  onLengthChange: (len: string) => void;
  disabled: boolean;
  /** 返信候補の開閉。押した時に候補を取りに行く */
  onSuggestToggle: () => void;
  suggestOpen: boolean;
  /** 会話がまだ無いと履歴が引けん。候補も出せんので押させん */
  canSuggest: boolean;
}

const WORD_LENGTHS = ["短め", "ふつう", "長め", "たっぷり"] as const;
const RESPONSE_LENGTH_VALUES = ["short", "medium", "long", "very_long"] as const;

const chipBaseClass =
  "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap font-sans-ui text-[12px] transition-colors duration-200 ease-[cubic-bezier(.32,.72,.27,1)] disabled:cursor-default disabled:opacity-60";

const chipStyle = (selected: boolean, strong = false): CSSProperties =>
  selected
    ? {
        padding: "7px 12px",
        borderRadius: 15,
        minHeight: 44,
        border: `1px solid ${strong ? OU2.chipGoldBorderStrong : OU2.chipGoldBorder}`,
        background: strong ? OU2.chipGoldBgStrong : OU2.chipGoldBg,
        color: strong ? OU2.chipTextStrong : OU2.pillText,
        fontWeight: strong ? 700 : 600,
      }
    : {
        padding: "7px 12px",
        borderRadius: 15,
        minHeight: 44,
        border: `1px solid ${OU2.chipBorder}`,
        background: OU2.chipBg,
        color: OU2.chipText,
      };

// 押せん間は生きたチップと見分けが付く濃さまで落とす。クラスの opacity は
// インラインの背景色と重なった時に効きが弱く、押せると誤認させる原因になっとった。
const disabledChipStyle: CSSProperties = { opacity: 0.35, cursor: "not-allowed" };

const getLengthIndex = (responseLength: string) => {
  const index = RESPONSE_LENGTH_VALUES.findIndex((value) => value === responseLength);
  return index >= 0 ? index : 1;
};

export const ChipsPanel = ({
  sayDoMode,
  onSayDoChange,
  responseLength,
  onLengthChange,
  disabled,
  onSuggestToggle,
  suggestOpen,
  canSuggest,
}: ChipsPanelProps) => {
  const suggestDisabled = disabled || !canSuggest;
  const lengthIndex = getLengthIndex(responseLength);
  const wordLength = WORD_LENGTHS[lengthIndex];
  const cycleWordLength = () => {
    const nextIndex = (lengthIndex + 1) % RESPONSE_LENGTH_VALUES.length;
    onLengthChange(RESPONSE_LENGTH_VALUES[nextIndex]);
  };

  return (
    <div
      className="border-t px-4 pt-[10px]"
      style={{ background: OU2.barBg, borderColor: OU2.inputBarTopBorder }}
    >
      <div
        className="mx-auto mb-[9px] flex min-w-0 max-w-3xl gap-[7px] overflow-x-auto pr-5 pb-[9px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, black calc(100% - 20px), transparent 100%)",
        }}
      >
        {/* 迷った時に最初に触るものなので、横スクロールせずに届く先頭へ置く */}
        <button
          type="button"
          onClick={onSuggestToggle}
          disabled={suggestDisabled}
          aria-disabled={suggestDisabled}
          aria-pressed={suggestOpen}
          title={canSuggest ? undefined : "会話が始まると使えます"}
          className={`${chipBaseClass} gap-[5px]`}
          style={{ ...chipStyle(suggestOpen), ...(suggestDisabled ? disabledChipStyle : null) }}
        >
          <Lightbulb size={13} aria-hidden />
          なんて言う？
        </button>
        <button
          type="button"
          onClick={() => onSayDoChange(sayDoMode === "say" ? null : "say")}
          disabled={disabled}
          aria-pressed={sayDoMode === "say"}
          className={chipBaseClass}
          style={chipStyle(sayDoMode === "say")}
        >
          セリフを渡す
        </button>
        <button
          type="button"
          onClick={() => onSayDoChange(sayDoMode === "do" ? null : "do")}
          disabled={disabled}
          aria-pressed={sayDoMode === "do"}
          className={chipBaseClass}
          style={chipStyle(sayDoMode === "do")}
        >
          ふるまいを渡す
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={cycleWordLength}
          disabled={disabled}
          className={chipBaseClass}
          style={chipStyle(true, responseLength === "very_long")}
        >
          ことば {wordLength}
        </button>
      </div>
    </div>
  );
};
