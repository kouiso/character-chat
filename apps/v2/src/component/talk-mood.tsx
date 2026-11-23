// 雰囲気（板 Mood）。場面台帳の phase を画面の語に写し、シートから切り替える。
// 変えた値は PATCH /api/chat/:id/ledger で最新台帳へ書き、次の返事から効く。
import { useEffect, useState, type ReactNode } from "react";

import { loadLedger, saveLedger, type LedgerData } from "../lib/ledger";
import { TalkIcon } from "./talk-icon";
import { TalkSheet } from "./talk-sheet";

const MOODS: { phase: LedgerData["phase"]; label: string }[] = [
  { phase: "conversation", label: "ふだん" },
  { phase: "intimate", label: "親しい" },
  { phase: "erotic", label: "深まる" },
  { phase: "climax", label: "最高潮" },
  { phase: "afterglow", label: "余韻" },
];

export const moodLabel = (phase: LedgerData["phase"] | undefined): string =>
  MOODS.find((mood) => mood.phase === phase)?.label ?? "ふだん";

type TalkMoodProps = {
  characterId: string;
  getConversationId: () => string | null;
  // 場面帯の右半分など、呼び出し側で読んだ phase を渡す時は再取得を省く。
  // null は「親が台帳を読んだが未作成」の印。省略の時だけ自分で読む。
  phase?: LedgerData["phase"] | null;
  // 行の形は呼び出し側が決める。今の雰囲気の語を渡す。
  trigger?: (label: string) => ReactNode;
  onChanged?: () => void;
};

export const TalkMood = ({
  characterId,
  getConversationId,
  phase,
  trigger,
  onChanged,
}: TalkMoodProps) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<LedgerData["phase"] | undefined>(phase ?? undefined);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 呼び出し側が phase を持たん時（トレイの行）は、開くのを待たず現在値を読む。
  useEffect(() => {
    if (phase !== undefined) {
      setCurrent(phase ?? undefined);
      return;
    }
    const conversationId = getConversationId();
    if (!conversationId) return;
    const abort = new AbortController();
    void loadLedger(characterId, conversationId, abort.signal)
      .then((loaded) => {
        if (!abort.signal.aborted && loaded) setCurrent(loaded.phase);
      })
      .catch(() => {});
    return () => abort.abort();
    // getConversationId は描画ごとに変わるので、対象の会話だけを依存にする。
  }, [characterId, phase, getConversationId()]);

  const openSheet = async () => {
    setOpen(true);
    setError(null);
    const conversationId = getConversationId();
    if (!conversationId) {
      setLedger(null);
      return;
    }
    try {
      const loaded = await loadLedger(characterId, conversationId, new AbortController().signal);
      setLedger(loaded);
      if (loaded) setCurrent(loaded.phase);
    } catch {
      setError("雰囲気を読み込めませんでした。");
    }
  };

  const pick = async (next: LedgerData["phase"]) => {
    const conversationId = getConversationId();
    if (!conversationId || !ledger || saving) return;
    if (next === ledger.phase) {
      setOpen(false);
      return;
    }
    const before = current;
    setSaving(true);
    setError(null);
    try {
      const updated: LedgerData = { ...ledger, phase: next };
      const turn = await saveLedger(characterId, conversationId, updated);
      if (turn === null) {
        setError("まだ場面の記録がありません。");
        return;
      }
      setLedger(updated);
      setCurrent(next);
      setOpen(false);
      onChanged?.();
    } catch {
      // 板 Mood「雰囲気を変えられなかった時」: 失敗の文は前の値を明記して残す。
      setError(`雰囲気を変えられませんでした。前の「${moodLabel(before)}」のままです。`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="v2-talk-mood-toggle"
        onClick={() => void openSheet()}
        disabled={!getConversationId()}
      >
        {trigger?.(moodLabel(current)) ?? (
          <>
            <span className="v2-talk-lamp" aria-hidden="true" />
            <span>{moodLabel(current)}</span>
            <TalkIcon name="down" />
          </>
        )}
      </button>
      {open && (
        <TalkSheet title="雰囲気" onClose={() => setOpen(false)}>
          <div className="v2-talk-mood">
            {error && (
              <div className="v2-error" role="alert">
                {error}
              </div>
            )}
            <div className="v2-talk-action-list">
              {MOODS.map((mood) => (
                <button
                  key={mood.phase}
                  type="button"
                  aria-pressed={current === mood.phase}
                  disabled={saving || ledger === null}
                  onClick={() => void pick(mood.phase)}
                >
                  {mood.label}
                </button>
              ))}
            </div>
            <p className="v2-talk-caption">次の返事から、この雰囲気で進みます。</p>
          </div>
        </TalkSheet>
      )}
    </>
  );
};
