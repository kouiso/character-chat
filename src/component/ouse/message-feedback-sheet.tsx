import { useRef, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/component/ui/sheet";
import { cn } from "@/lib/utils";

import { OU2 } from "./ouse-tokens";

// 定型の減点理由。最後の「ことばで伝える…」は自由記述への入口。
const PRESET_REASONS = ["口調がちがう", "展開が早い", "設定とズレてる", "長すぎる"] as const;
const FREE_TEXT_KEY = "__free__";

export type MessageFeedbackPayload = {
  // 選んだ理由（自由記述時は入力テキスト、空なら未選択）
  reason: string;
  // 「伝えて書き直させる」= true / 「伝えるだけ」= false
  rewrite: boolean;
};

type MessageFeedbackSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: MessageFeedbackPayload) => void;
};

const dragHandleClass =
  "mx-auto h-1 w-9 rounded-full bg-[var(--lamp-30)] shadow-[var(--read-shadow-soft)]";

// ゴールドの primary ボタン。design C-4 指定のグラデーションをそのまま使う。
const primaryButtonStyle = {
  background: OU2.lampGrad,
} as const;

export const MessageFeedbackSheet = ({
  open,
  onOpenChange,
  onSubmit,
}: MessageFeedbackSheetProps): React.JSX.Element => {
  const [selected, setSelected] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const freeInputRef = useRef<HTMLTextAreaElement>(null);

  // 閉じるたびに選択状態をリセットし、次回開いたときに前回の選択が残らないようにする
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelected(null);
      setFreeText("");
    }
    onOpenChange(next);
  };

  const isFreeText = selected === FREE_TEXT_KEY;

  const resolveReason = (): string => {
    if (isFreeText) return freeText.trim();
    return selected ?? "";
  };

  // 理由未選択（チップ未選択 かつ 自由記述が空）のまま送信すると reason が
  // 空文字のままサーバに黙って捨てられ、何を伝えたのか分からず消える（サイレントバグ）。
  // 理由が確定するまで送信不可にして、フィードバックが必ず記録されるようにする。
  const hasReason = resolveReason().length > 0;

  const handleSubmit = (rewrite: boolean) => {
    if (!hasReason) return;
    onSubmit({ reason: resolveReason(), rewrite });
    handleOpenChange(false);
  };

  // 見た目は 36px のまま、::before で当たりだけ 44px へ広げる。行間 gap-2(8px) が
  // 上下のはみ出し 4px ずつをちょうど吸うので、折り返しても当たりは重ならない。
  const chipBase = cn(
    "min-h-[36px] rounded-[17px] px-[14px] py-2 text-[12px] transition-colors",
    "relative before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn(
          "max-h-[82dvh] rounded-t-[22px] border-[var(--lamp-30)] bg-[var(--night)]/95 px-[18px] pb-[calc(22px+env(safe-area-inset-bottom))] pt-[18px] text-[var(--text)] shadow-[0_-14px_40px_rgba(0,0,0,.4)] backdrop-blur-[24px]",
          "data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full",
        )}
      >
        <div className={dragHandleClass} aria-hidden="true" />
        <SheetHeader className="gap-1 px-0 pb-0 pt-[14px] text-left">
          <SheetTitle className="font-narrative text-[15px] font-medium tracking-normal text-[var(--text)] [text-shadow:var(--read-shadow)]">
            この返し、どこがイマイチ？
          </SheetTitle>
          <SheetDescription className="font-round text-[11.5px] leading-5 text-[var(--faint)]">
            この子の返し方にすぐ反映されます（採点ではありません）
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap gap-2 pt-[13px]">
          {PRESET_REASONS.map((reason) => {
            const active = selected === reason;
            return (
              <button
                key={reason}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(active ? null : reason)}
                className={cn(
                  chipBase,
                  active
                    ? "bg-[var(--lamp)] font-bold text-[var(--night)]"
                    : "border border-[var(--lamp-30)] text-[var(--dim)]",
                )}
              >
                {reason}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={isFreeText}
            onClick={() => {
              setSelected(isFreeText ? null : FREE_TEXT_KEY);
              // 選択と同時に入力欄へフォーカスして、そのまま書ける導線にする
              window.setTimeout(() => freeInputRef.current?.focus(), 0);
            }}
            className={cn(
              chipBase,
              isFreeText
                ? "border border-solid border-[var(--lamp)] text-[var(--lamp)]"
                : "border border-dashed border-[var(--lamp-30)] text-[var(--faint)]",
            )}
          >
            ことばで伝える…
          </button>
        </div>

        {isFreeText ? (
          <textarea
            ref={freeInputRef}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            rows={2}
            maxLength={500}
            aria-label="ことばで伝える"
            placeholder="どう返してほしかった？"
            className="mt-3 w-full resize-none rounded-[14px] border border-[var(--lamp-30)] bg-transparent px-3 py-2 font-round text-[13px] leading-6 text-[var(--text)] placeholder:text-[var(--ghost)] focus:border-[var(--lamp)] focus:outline-none"
          />
        ) : null}

        {!hasReason ? (
          <p className="pt-[10px] font-round text-[11px] text-[var(--faint)]">
            どこがイマイチか選ぶ（またはことばで伝える）と送れるようになります
          </p>
        ) : null}

        <div className="flex gap-[9px] pt-[14px]">
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={!hasReason}
            style={hasReason ? primaryButtonStyle : undefined}
            className={cn(
              "flex-1 rounded-[20px] py-3 text-center text-[12.5px] font-bold",
              hasReason
                ? "text-[var(--night)]"
                : "cursor-not-allowed border border-[var(--lamp-30)] text-[var(--faint)] opacity-50",
            )}
          >
            伝えて書き直させる
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={!hasReason}
            className={cn(
              "shrink-0 rounded-[20px] border border-[var(--lamp-30)] px-[18px] py-3 text-[12.5px]",
              hasReason ? "text-[var(--dim)]" : "cursor-not-allowed text-[var(--faint)] opacity-50",
            )}
          >
            伝えるだけ
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
