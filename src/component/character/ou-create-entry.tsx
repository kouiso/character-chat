import type { ComponentType } from "react";

import { Check, Diamond, Quote, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

interface OuCreateEntryProps {
  onSelectAuto: () => void;
  onSelectScenario: () => void;
  onSelectWizard: () => void;
}

interface Choice {
  title: string;
  desc: string;
  action: "onSelectAuto" | "onSelectScenario" | "onSelectWizard";
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  featured?: boolean;
}

const choices: Choice[] = [
  {
    title: "おまかせでつくる",
    desc: "話しながら決める。ぼんやりしたイメージでも、こちらから聞きながら形にします。",
    action: "onSelectAuto",
    icon: Sparkles,
    badge: "いちばんかんたん",
    featured: true,
  },
  {
    title: "シナリオからつくる",
    desc: "好きな物語や設定を貼り付けるだけ。登場人物・関係・振る舞いまで、その世界の子として組み立てます。",
    action: "onSelectScenario",
    icon: Quote,
  },
  {
    title: "こだわってつくる",
    desc: "タイプ・関係・性格・体型をえらんで指定。細部まで自分で決めたい人に。",
    action: "onSelectWizard",
    icon: Diamond,
  },
];

export const OuCreateEntry = ({
  onSelectAuto,
  onSelectScenario,
  onSelectWizard,
}: OuCreateEntryProps) => {
  const handlers = { onSelectAuto, onSelectScenario, onSelectWizard };
  return (
    <div className="space-y-4">
      <p className="font-narrative text-[15px] leading-8 text-[var(--dim)]">
        この世のどこにもいない、
        <br />
        あなただけの子を。
      </p>

      <div className="space-y-3">
        {choices.map((choice) => {
          const Icon = choice.icon;
          return (
            <button
              key={choice.title}
              type="button"
              onClick={handlers[choice.action]}
              className={cn(
                "group relative flex min-h-[132px] w-full rounded-[22px] border p-5 text-left transition",
                choice.featured
                  ? "border-[var(--lamp-45)] bg-[linear-gradient(145deg,var(--lamp-22),var(--lamp-7))] shadow-[0_0_28px_-6px_var(--lamp-22)]"
                  : "border-[var(--hairline)] bg-[var(--veil)] hover:border-[var(--lamp-45)] hover:bg-[var(--lamp-7)]",
              )}
            >
              {/* いちばんかんたんバッジ：タイトルと切り離しカード右上に固定 */}
              {choice.badge && (
                <span className="absolute top-3.5 right-4 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--success)]/35 bg-[var(--ink)] px-2.5 py-0.5 font-sans-ui text-[10.5px] font-medium tracking-[0.08em] text-[var(--success)]">
                  <Check className="h-3 w-3" />
                  {choice.badge}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                {/* タイトルの視線を先に作るため、円バッジではなくフラットな大きめグリフを置く */}
                <Icon
                  className={cn(
                    "h-5 w-5",
                    choice.featured ? "text-[var(--lamp)]" : "text-[var(--dim)]",
                  )}
                />
                <p
                  className={cn(
                    "mt-2.5 font-narrative text-[17px] font-medium tracking-[0.06em] text-[var(--text)]",
                    choice.badge && "pr-24",
                  )}
                >
                  {choice.title}
                </p>
                <p className="mt-1.5 font-sans-ui text-[12.5px] leading-6 text-[var(--dim)]">
                  {choice.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="font-sans-ui text-[11.5px] leading-5 text-[var(--ghost)]">
        どのルートでも、最後にぜんぶ手直しできます ・ 2回目からは前回のルートをすぐ開きます
      </p>
    </div>
  );
};
