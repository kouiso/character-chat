import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";

import { Eye, Heart, Move, PenLine, Sparkle } from "lucide-react";

import { fetchReplySuggestions } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import { buildSayDoDirective } from "@/lib/say-do-directive";
import { detectScenePhase } from "@/lib/scene-phase";
import { getFallbackSuggestions } from "@/lib/suggestion-fallback";
import { cn } from "@/lib/utils";
import { useCharacterSettingsStore, useReplySettings } from "@/store/character-settings-store";
import { useChatStore } from "@/store/chat-store";
import { type ResponseLength, useSettingsStore } from "@/store/settings-store";

import { BegSheet } from "./beg-sheet";
import { ChatscopeInputBar } from "./chatscope-input-bar";
import { ChipsPanel } from "./chips-panel";
import { CONTENT_EDITOR_SELECTOR, insertComposerDraft, readComposerDraft } from "./composer-draft";
import { OU2 } from "./ouse-tokens";
import { ReplySuggestionPanel, type ReplySuggestionStatus } from "./reply-suggestion-panel";

const logger = createLogger("composer");

const AUTO_SUGGEST_DELAY_MS = 400;

const fallbackRetryButtonClass =
  "inline-flex shrink-0 items-center rounded-[12px] px-2.5 py-1.5 font-sans-ui text-[11px] transition-colors duration-200 ease-[cubic-bezier(.32,.72,.27,1)]";

interface OuseComposerProps {
  onSend: (message: string) => void;
  onSendDirective: (directive: string) => void;
  onImageGenerate: () => void;
  isLoading: boolean;
  isImageGenerating?: boolean;
  characterName: string;
  /** この子との設定シートと同じ保存先へ書くため。null なら全体設定を読み書きする */
  characterId?: string | null;
  /** 返信候補は履歴から作るので会話が要る。null なら候補ボタンを押させん */
  conversationId?: string | null;
}

const RESPONSE_LENGTHS: ResponseLength[] = ["short", "medium", "long", "very_long"];

// ねだる（設計 2b）: ことばにする前の、ちいさなお願い。叶うかは彼女の気分次第。
// action="image" は写真生成、"directive" は AI への振る舞い指示、"free" は自分で入力。
type BegAction = { kind: "image" } | { kind: "directive"; prompt: string } | { kind: "free" };

interface BegItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  action: BegAction;
  featured?: boolean;
  dashed?: boolean;
}

const BEG_ITEMS: BegItem[] = [
  { id: "image", label: "いまの顔が見たい", icon: Eye, action: { kind: "image" }, featured: true },
  {
    id: "closer",
    label: "もっと近くで",
    icon: Move,
    action: { kind: "directive", prompt: "もっと近くに来て。距離を詰めて、触れ合いを増やして。" },
  },
  {
    id: "continue",
    label: "つづけて",
    icon: Sparkle,
    action: { kind: "directive", prompt: "今の流れを止めずに、そのまま続けて。" },
  },
  {
    id: "gentle",
    label: "やさしくして",
    icon: Heart,
    action: { kind: "directive", prompt: "今は言葉も仕草も、いつもよりやさしく甘くして。" },
  },
  {
    id: "tease",
    label: "いじわるして",
    icon: Sparkle,
    action: {
      kind: "directive",
      prompt: "すこしだけ意地悪に、焦らすようにして。すぐには応えないで。",
    },
  },
  { id: "free", label: "じぶんのことばで", icon: PenLine, action: { kind: "free" }, dashed: true },
];

const isResponseLength = (value: string): value is ResponseLength =>
  RESPONSE_LENGTHS.includes(value as ResponseLength);

// 「じぶんのことばで」選択時にフォーカスを戻す先は ChatscopeInputBar 内の contenteditable。
// シート閉じるアニメーション（150ms、settings-panel等と同じ）がフォーカスガードを持つため、
// 閉じ切る前に focus() すると base-ui 側の復帰処理に上書きされる。閉じ切ってから当てる。
const BEG_SHEET_CLOSE_MS = 200;

export const OuseComposer = ({
  onSend,
  onSendDirective,
  onImageGenerate,
  isLoading,
  isImageGenerating = false,
  characterName,
  characterId = null,
  conversationId = null,
}: OuseComposerProps) => {
  const [begSheetOpen, setBegSheetOpen] = useState(false);
  const [sayDoMode, setSayDoMode] = useState<"say" | "do" | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestStatus, setSuggestStatus] = useState<ReplySuggestionStatus>("loading");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // 通信が落ちて手持ちの言いかたを出しとる状態。AIが選んだ候補と混ぜて見せんための印。
  const [suggestFallback, setSuggestFallback] = useState(false);
  // 「出し直す」を連打された時、先に投げた分の応答が後から届いて新しい組を上書きする。
  // 最後に投げた回だけを採用する。
  const suggestRequestRef = useRef(0);
  // 「この子との設定」シートと同じ値を読み書きする。片方だけ全体設定を見とると、
  // シートで長さを決めたキャラでこのチップが無反応になる（シートの
  // 「会話中のチップからも変えられます」が嘘になる）。
  const { responseLength } = useReplySettings(characterId);
  const patchCharacterSettings = useCharacterSettingsStore((s) => s.patch);
  const setGlobalResponseLength = useSettingsStore((s) => s.setResponseLength);

  const handleSend = useCallback(
    (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || isLoading) return;

      if (sayDoMode) {
        onSendDirective(buildSayDoDirective(sayDoMode, trimmed));
        setSayDoMode(null);
      } else {
        onSend(trimmed);
      }
    },
    [isLoading, onSend, onSendDirective, sayDoMode],
  );

  // 会話行の有無で閉じん。1手目こそ「何て言えばええか分からん」瞬間で、
  // そこで押せんかったら機能として存在せんのと同じ。
  const canSuggest = Boolean(characterId);

  const loadSuggestions = useCallback(async () => {
    if (!characterId) return;
    const requestId = suggestRequestRef.current + 1;
    suggestRequestRef.current = requestId;
    setSuggestOpen(true);
    setSuggestStatus("loading");
    setSuggestions([]);
    setSuggestFallback(false);
    try {
      const next = await fetchReplySuggestions({
        conversationId: conversationId ?? undefined,
        characterId,
      });
      if (suggestRequestRef.current !== requestId) return;
      setSuggestions(next);
      // 通信が通って0件やった時は代替候補を出さん。AIが返した結果を作り話で覆い隠すことになる。
      setSuggestStatus(next.length > 0 ? "ready" : "error");
    } catch (error) {
      if (suggestRequestRef.current !== requestId) return;
      logger.error("reply suggestions failed", error);
      // 落ちた時に空の状態だけ残すと、次に何を言うかを毎回自分で考えることになる。
      // 場面はサーバーと同じ判定で見て、その段階に合う言いかたを手持ちから出す。
      setSuggestions(getFallbackSuggestions(detectScenePhase(useChatStore.getState().messages)));
      setSuggestStatus("ready");
      setSuggestFallback(true);
    }
  }, [characterId, conversationId]);

  // 返事が届いた直後に候補を出す。押してから待つ形やと、次に何を言うかを
  // 毎ターン自分で考えることになる（局長報告 2026-08-18:「次の返信が予測して楽に出るように」）。
  // 書きかけがある時は出さん——上書きで文が消えるし、要らん生成に金がかかる。
  // 一拍おくのは、配信が終わったフレームへ次のネットワーク呼び出しを重ねんため
  // （ou-app.tsx の自動画像生成が同じ理由で 700ms 待つ）。
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    const justFinished = wasLoadingRef.current && !isLoading;
    wasLoadingRef.current = isLoading;
    if (!justFinished || !canSuggest || suggestOpen) return;
    const timer = setTimeout(() => {
      if (readComposerDraft(document).length > 0) return;
      void loadSuggestions();
    }, AUTO_SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isLoading, canSuggest, suggestOpen, loadSuggestions]);

  const handleSuggestToggle = useCallback(() => {
    if (suggestOpen) {
      setSuggestOpen(false);
      return;
    }
    void loadSuggestions();
  }, [loadSuggestions, suggestOpen]);

  // 候補は送らん。入力欄へ入れて、直してから自分で送れる状態にする。
  // 途中まで打っとった文は候補で置き換わる——候補は一言まるごとなので、
  // 継ぎ足すと文が二重になる。閉じた上でキャレットを末尾へ置き、すぐ直せるようにする。
  const handleSuggestionSelect = useCallback((suggestion: string) => {
    insertComposerDraft(document, suggestion);
    setSuggestOpen(false);
  }, []);

  // この子へ効かせつつ、全体の既定値も動かす。設定画面のグローバルな「ことばの量」は
  // devMode の中にあって普段は出てこんので、このチップが唯一の全体制御になっとる。
  // この子だけに書くと、まだ設定してへん子の既定を変える手段が無くなってまう。
  const handleLengthChange = useCallback(
    (value: string) => {
      if (!isResponseLength(value)) return;
      if (characterId) patchCharacterSettings(characterId, { responseLength: value });
      setGlobalResponseLength(value);
    },
    [characterId, patchCharacterSettings, setGlobalResponseLength],
  );

  return (
    <>
      {suggestOpen && suggestFallback && (
        <div
          className="border-t px-4 pt-[10px] pb-[9px]"
          style={{ background: OU2.barBg, borderColor: OU2.inputBarTopBorder }}
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
            <span className="font-round text-[12px]" style={{ color: OU2.warnText }}>
              候補が出せんかった。
            </span>
            <button
              type="button"
              onClick={() => {
                void loadSuggestions();
              }}
              className={fallbackRetryButtonClass}
              style={{ border: `1px solid ${OU2.warnBorder}`, color: OU2.warnText }}
            >
              もう一度
            </button>
          </div>
        </div>
      )}
      {suggestOpen && (
        <ReplySuggestionPanel
          status={suggestStatus}
          suggestions={suggestions}
          onSelect={handleSuggestionSelect}
          onRegenerate={() => {
            void loadSuggestions();
          }}
          onClose={() => setSuggestOpen(false)}
        />
      )}
      <ChipsPanel
        sayDoMode={sayDoMode}
        onSayDoChange={setSayDoMode}
        responseLength={responseLength}
        onLengthChange={handleLengthChange}
        disabled={isLoading}
        onSuggestToggle={handleSuggestToggle}
        suggestOpen={suggestOpen}
        canSuggest={canSuggest}
      />
      <ChatscopeInputBar
        onSend={handleSend}
        onImageGenerate={onImageGenerate}
        onBegSheetOpen={() => setBegSheetOpen(true)}
        isLoading={isLoading}
        isImageGenerating={isImageGenerating}
        characterName={characterName}
      />
      <BegSheet open={begSheetOpen} onOpenChange={setBegSheetOpen}>
        <div className="grid grid-cols-2 gap-2.5 py-1">
          {BEG_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.action.kind === "image" && !isImageGenerating) onImageGenerate();
                  else if (item.action.kind === "directive") onSendDirective(item.action.prompt);
                  else if (item.action.kind === "free") {
                    window.setTimeout(() => {
                      document.querySelector<HTMLElement>(CONTENT_EDITOR_SELECTOR)?.focus();
                    }, BEG_SHEET_CLOSE_MS);
                  }
                  setBegSheetOpen(false);
                }}
                className={cn(
                  "rounded-[16px] px-4 py-3.5 text-left transition-colors",
                  item.dashed
                    ? "border border-dashed border-[var(--hairline)] hover:border-[var(--lamp-45)]"
                    : item.featured
                      ? "border border-[var(--lamp-45)] bg-[var(--lamp-14)]"
                      : "border border-[var(--hairline)] bg-[var(--veil)] hover:bg-[var(--lamp-7)]",
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px]",
                    item.dashed ? "text-[var(--ghost)]" : "text-[var(--lamp)]",
                  )}
                />
                <span
                  className={cn(
                    "mt-2 block font-round text-[13px] tracking-[0.04em]",
                    item.dashed ? "text-[var(--ghost)]" : "text-[var(--text)]",
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="px-1 pt-3 font-round text-[10.5px] leading-6 text-[var(--ghost)]">
          叶うかどうかは、彼女の気分次第。
        </p>
      </BegSheet>
    </>
  );
};
