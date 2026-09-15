import { useMemo, useState } from "react";

import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { ctaPrimaryClass, goldLabelClass, wizardInputClass } from "./wizard-steps";

interface OuCreateScenarioProps {
  onGenerate: (input: { situation: string; details: string }) => void;
}

const extractName = (text: string): string | null => {
  const quoted = text.match(/[「『"]([^」』"]{1,16})[」』"]/u)?.[1];
  if (quoted && quoted.length <= 8) return quoted;
  return (
    text
      .split(/\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && line.length <= 12) ?? null
  );
};

const extractScene = (text: string): string | null =>
  text
    .split(/[\n。]/u)
    .map((line) => line.trim())
    .find((line) => line.length > 10) ?? null;

export const OuCreateScenario = ({ onGenerate }: OuCreateScenarioProps) => {
  const [text, setText] = useState("");
  const read = useMemo(() => ({ name: extractName(text), scene: extractScene(text) }), [text]);
  const hasText = text.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <p className={goldLabelClass}>展開したい物語・設定を貼り付け</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="週に二度、彼女は家庭教師として俺の部屋に来る。教科書よりも近い距離。消しゴムを取る指が、今日はやけにゆっくりで——「……ここ、まちがえてる」と囁く声が、いつもより低い。"
          className={cn(wizardInputClass, "min-h-[184px] resize-y font-narrative leading-7")}
          maxLength={2000}
        />
        <div className="mt-1.5 flex items-center justify-between font-sans-ui text-[11.5px] text-[var(--ghost)]">
          <span>途中まででも、あらすじだけでも大丈夫</span>
          <span>{text.length}字</span>
        </div>
      </div>

      {hasText && (
        <div className="space-y-2.5 rounded-[16px] border border-[var(--hairline)] bg-[var(--veil)] p-3.5">
          <p className="font-sans-ui text-[11px] tracking-[0.2em] text-[var(--lamp)]">
            読み取り中…
          </p>
          {read.name && (
            <p className="flex items-center gap-2 font-sans-ui text-[12.5px] text-[var(--dim)]">
              <Check className="h-3.5 w-3.5 text-[var(--success)]" />
              登場人物 — <span className="text-[var(--text)]">{read.name}</span>
            </p>
          )}
          {read.scene && (
            <p className="flex items-start gap-2 font-sans-ui text-[12.5px] text-[var(--dim)]">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
              <span>
                はじまりの場面 — <span className="text-[var(--text)]">{read.scene}</span>
              </span>
            </p>
          )}
          <p className="flex items-center gap-2 font-sans-ui text-[12.5px] text-[var(--ghost)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--lamp-55)]" />
            性格・口調・秘めた面を組み立てています…
          </p>
        </div>
      )}

      <p className="font-sans-ui text-[11.5px] leading-5 text-[var(--ghost)]">
        物語の続きから始めることも、同じ子と別の場面から始めることもできます。
      </p>

      <button
        type="button"
        disabled={!hasText}
        onClick={() => onGenerate({ situation: read.scene ?? "", details: text })}
        className={ctaPrimaryClass}
      >
        つくる
      </button>
    </div>
  );
};
