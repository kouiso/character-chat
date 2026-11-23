// 雰囲気（板 Mood）。場面台帳の phase を画面の語に写し、シートから切り替える。
// 変えた値は PATCH /api/chat/:id/ledger で最新台帳へ書き、次の返事から効く。
import { useEffect, useRef, useState, type ReactNode } from "react";

import { loadLedger, saveLedgerPhase, type LedgerData } from "../lib/ledger";
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
  // 別の場所（場面帯など）で雰囲気が変わった時に読み直すための合図。変わるたび取り直す。
  reloadSignal?: number;
};

export const TalkMood = ({
  characterId,
  getConversationId,
  phase,
  trigger,
  onChanged,
  reloadSignal = 0,
}: TalkMoodProps) => {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<LedgerData["phase"] | undefined>(phase ?? undefined);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 初期読み込みが失敗した印。失敗時に current が空のままだと、行が
  // 「ふだん」と見えて読めてないことと区別がつかんので、表示を分ける。
  const [loadFailed, setLoadFailed] = useState(false);
  // 保存が成功した版の番号。保存より先に出した読み込みが遅れて返っても、
  // 新しい雰囲気を古い値で上書きせんよう、届いた時点で番号がズレてたら捨てる。
  const savedSeq = useRef(0);

  // 呼び出し側が phase を持たん時（トレイの行）は、開くのを待たず現在値を読む。
  // 会話の変わり目だけ見ればよいので、描画の時点の会話番号を依存にする。
  const conversationId = getConversationId();
  useEffect(() => {
    if (phase !== undefined) {
      setCurrent(phase ?? undefined);
      return;
    }
    if (!conversationId) return;
    const abort = new AbortController();
    const seq = savedSeq.current;
    void loadLedger(characterId, conversationId, abort.signal)
      .then((loaded) => {
        if (abort.signal.aborted) return;
        if (loaded && seq === savedSeq.current) {
          setCurrent(loaded.phase);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        // 失敗も捨てんと覚えておく。シートを開く時にもう一度読み、そこで文を出す。
        if (abort.signal.aborted) return;
        setError("雰囲気を読み込めませんでした。");
        setLoadFailed(true);
      });
    return () => abort.abort();
  }, [characterId, phase, conversationId, reloadSignal]);

  const openSheet = async () => {
    setOpen(true);
    setError(null);
    const conversationId = getConversationId();
    if (!conversationId) {
      setLedger(null);
      return;
    }
    const seq = savedSeq.current;
    try {
      const loaded = await loadLedger(characterId, conversationId, new AbortController().signal);
      if (seq !== savedSeq.current) return;
      setLedger(loaded);
      if (loaded) {
        setCurrent(loaded.phase);
        setLoadFailed(false);
      }
    } catch {
      setError("雰囲気を読み込めませんでした。");
      setLoadFailed(true);
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
      // サーバーは最新台帳行の phase だけを差し替える。開いた時点の台帳を
      // 丸ごと送ると、生成で新しく積まれた行を古い内容で潰してしまう。
      const turn = await saveLedgerPhase(characterId, conversationId, next);
      if (turn === null) {
        setError("まだ場面の記録がありません。");
        return;
      }
      savedSeq.current += 1;
      setLedger((prev) => (prev ? { ...prev, phase: next } : prev));
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

  // 読み込み失敗で値が無い時は「ふだん」ではなく失敗を出す（開く前から分かるように）。
  const label = current === undefined && loadFailed ? "読み込めません" : moodLabel(current);

  return (
    <>
      <button
        type="button"
        className="v2-talk-mood-toggle"
        onClick={() => void openSheet()}
        disabled={!conversationId}
      >
        {trigger?.(label) ?? (
          <>
            <span className="v2-talk-lamp" aria-hidden="true" />
            <span>{label}</span>
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
