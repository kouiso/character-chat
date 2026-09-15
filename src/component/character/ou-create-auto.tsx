import { useEffect, useState } from "react";

import { ArrowUp, Sparkles } from "lucide-react";

import { CHIP_CATEGORIES, type CharacterSelections } from "@/lib/character-generator";
import { cn } from "@/lib/utils";

interface AutoInput {
  selections: CharacterSelections;
  details: string;
}

interface OuCreateAutoProps {
  onGenerate: (input: AutoInput) => void;
  // 親（ヘッダーの「もう作って」）が最新入力で生成できるよう同期する
  onInputChange?: (input: AutoInput) => void;
}

const initialSelections: CharacterSelections = {
  types: [],
  relations: [],
  personalities: [],
  bodyTypes: [],
  freeText: "",
};

// 「ふたりの関係は？」への答えの候補（design A-2 の提案チップ）
const relationChips = CHIP_CATEGORIES.find((c) => c.key === "relations")?.chips.slice(0, 4) ?? [];

const Bubble = ({ role, children }: { role: "ai" | "user"; children: React.ReactNode }) =>
  role === "ai" ? (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--lamp-14)] text-[var(--lamp)]">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <p className="max-w-[82%] rounded-[18px] rounded-tl-[6px] border border-[var(--hairline)] bg-[var(--veil)] px-3.5 py-2.5 font-sans-ui text-[13.5px] leading-6 text-[var(--text)]">
        {children}
      </p>
    </div>
  ) : (
    <div className="flex justify-end">
      {/* design A-2: ユーザー吹き出しは単色でなく2段グラデ（明るい金→やや濃い金） */}
      <p className="max-w-[82%] rounded-[18px] rounded-tr-[6px] border border-[var(--hairline)] bg-[linear-gradient(145deg,var(--lamp-30),var(--lamp-22))] px-3.5 py-2.5 font-sans-ui text-[13.5px] leading-6 text-[var(--text)]">
        {children}
      </p>
    </div>
  );

export const OuCreateAuto = ({ onGenerate, onInputChange }: OuCreateAutoProps) => {
  const [relation, setRelation] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState("");

  const buildInput = (): AutoInput => {
    const detailParts = [answer, relation ? `ふたりの関係は${relation}` : "", hint].filter(Boolean);
    const details = detailParts.join("。");
    return {
      selections: {
        ...initialSelections,
        relations: relation ? [relation] : [],
        freeText: details,
      },
      details,
    };
  };

  useEffect(() => {
    onInputChange?.(buildInput());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relation, answer, hint]);

  const send = () => {
    if (hint.trim()) {
      setAnswer((prev) => (prev ? `${prev}。${hint.trim()}` : hint.trim()));
      setHint("");
    }
    onGenerate(buildInput());
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Bubble role="ai">どんな子に会いたい？ 思いつくまま教えて。雰囲気だけでも大丈夫。</Bubble>
        {answer && <Bubble role="user">{answer}</Bubble>}
        <Bubble role="ai">
          いいね。ひとつだけ——ふたりの<span className="text-[var(--lamp)]">関係</span>は？
        </Bubble>
        {relation && <Bubble role="user">{relation}</Bubble>}
      </div>

      <div className="flex flex-wrap gap-2">
        {relationChips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => setRelation(chip)}
            className={cn(
              "min-h-[44px] rounded-full border px-3.5 py-1.5 font-sans-ui text-[12.5px] tracking-[0.04em] transition-colors",
              relation === chip
                ? "border-transparent bg-[var(--lamp)] text-[var(--night)]"
                : "border-[var(--hairline)] bg-[var(--night)]/35 text-[var(--dim)] hover:text-[var(--text)]",
            )}
          >
            {chip}
          </button>
        ))}
        <span className="min-h-[44px] rounded-full border border-dashed border-[var(--hairline)] px-3.5 py-1.5 font-sans-ui text-[12.5px] text-[var(--ghost)]">
          自由に書く…
        </span>
      </div>

      <p className="font-sans-ui text-[11.5px] leading-5 text-[var(--ghost)]">
        あと1〜2問で組み立てられます ・ 右上「もう作って」でいつでも生成へ
      </p>

      <div className="flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--veil)] py-1.5 pl-4 pr-1.5">
        <input
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="ことばで答える…"
          className="min-h-[44px] flex-1 bg-transparent font-sans-ui text-[13.5px] text-[var(--text)] outline-none placeholder:text-[var(--ghost)]"
          maxLength={500}
        />
        <button
          type="button"
          onClick={send}
          aria-label="送信"
          className="grid h-10 w-10 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-full bg-[var(--lamp)] text-[var(--night)] shadow-[0_8px_20px_-8px_var(--lamp-55)]"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
