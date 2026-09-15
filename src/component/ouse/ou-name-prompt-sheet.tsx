import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Sheet, SheetContent, SheetTitle } from "@/component/ui/sheet";
import { updateMyDisplayName, type MeResponse } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import { markNamePromptAsked } from "@/lib/name-prompt-state";
import { cn } from "@/lib/utils";

// 会話開始時に一度だけ、呼び方を尋ねる導線。設定画面へ行かせず、その場で決められる。
// 未入力でもスキップして会話を続けられ、一度出たら（スキップ含め）二度と出さない。
const logger = createLogger("ou-name-prompt-sheet");

interface OuNamePromptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterName: string;
}

// ou-reply-settings-sheet.tsx と同じ考え方: 指の当たりだけ 44px へ広げ、描画サイズは据え置く。
const TOUCH_TARGET_44 =
  "relative before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

// settings-panel.tsx の同名関数と同じ理由: サロゲートペアを割らずに24 UTF-16単位へ収める
// （サーバの sanitizeUserDisplayName の上限と揃える）。
const truncateName = (value: string, maxUnits: number): string => {
  let result = "";
  for (const char of value) {
    if (result.length + char.length > maxUnits) break;
    result += char;
  }
  return result;
};

export const OuNamePromptSheet = ({
  open,
  onOpenChange,
  characterName,
}: OuNamePromptSheetProps) => {
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  // アカウント単位のdisplayNameへ保存する。キャラ個別のuserPersonaNameには編集UIが
  // まだ無く（ou-edit-screenは既存値の維持のみ）、resolveUserDisplayNameのフォールバック
  // 先であるこちらが唯一の書き込み先になる。
  const saveMutation = useMutation({
    mutationFn: (value: string) => updateMyDisplayName(value),
    onSuccess: (saved) => {
      markNamePromptAsked();
      queryClient.setQueryData<MeResponse | undefined>(["me"], (prev) =>
        prev ? { ...prev, displayName: saved } : prev,
      );
    },
    onError: () => {
      // 保存に失敗した時は既読にせん。ここで既読にすると、名前で呼ばれることを
      // 選んだ人が二度と尋ねられんまま「あなた」で固定される。設定画面へ行けとは言えん
      // ——設定画面へ行かせんために作った導線やから。次の会話開始でもう一度出す。
      logger.warn("名前の保存に失敗しました");
    },
  });

  // スキップ（明示的に閉じた）時だけ、保存を待たずに既読にする。
  const dismiss = (): void => {
    markNamePromptAsked();
    onOpenChange(false);
  };

  const handleSubmit = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveMutation.mutate(trimmed);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-[var(--hairline)] bg-[var(--night)]/95 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 text-[var(--text)] shadow-[0_-24px_64px_rgba(5,3,2,.62)] backdrop-blur-[24px]"
      >
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-[var(--hairline)]" aria-hidden />
        <SheetTitle className="mb-1.5 text-center font-narrative text-[17px] font-medium tracking-[0.08em] text-[var(--text)]">
          呼び方を、教えて
        </SheetTitle>
        <p className="mb-5 text-center font-sans-ui text-[11.5px] leading-6 text-[var(--dim)]">
          {characterName}が、あなたの名前で呼びたがってる。
          <br />
          決めなくても、このまま話せます。
        </p>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(truncateName(e.target.value, 24))}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          maxLength={24}
          placeholder="呼ばれたい名前で"
          aria-label="あなたの名前"
          autoFocus
          className={cn(
            "w-full rounded-[14px] border border-[var(--hairline)] bg-[var(--veil)] px-4 py-3 font-sans-ui text-[13px] text-[var(--text)] placeholder:text-[var(--ghost)]",
            TOUCH_TARGET_44,
          )}
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim()}
          className={cn(
            "mt-4 w-full rounded-[26px] py-3.5 text-center font-sans-ui text-[14px] font-bold transition-colors",
            TOUCH_TARGET_44,
            name.trim()
              ? "bg-[var(--lamp)] text-[var(--night)]"
              : "bg-[var(--hairline)] text-[var(--faint)]",
          )}
        >
          この名前で呼んでもらう
        </button>
        <button
          type="button"
          onClick={dismiss}
          className={cn(
            "mt-2 w-full rounded-[26px] py-2.5 text-center font-sans-ui text-[12.5px] text-[var(--ghost)]",
            TOUCH_TARGET_44,
          )}
        >
          あとで決める
        </button>
      </SheetContent>
    </Sheet>
  );
};
