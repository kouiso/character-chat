import { useEffect, useState } from "react";

import { fetchSuggestions } from "../lib/suggest";
import { TalkIcon } from "./talk-icon";

// RIT-203: 次の発話候補チップ。板の決めどおり、返事が届くたびに自動で用意する
//（トレイの「返事の候補」で切った時は出さん）。選んだ文は親の送信経路へ渡す。

type SuggestionChipsProps = {
  characterId: string;
  // 会話は最初の送信で初めてサーバへ作られるので、値は描画のたび最新を渡す。
  conversationId: string | null;
  disabled: boolean;
  // 返事が進む・枝で差し替わるたび変わる値。変わったら候補を取り直す。
  version: string;
  enabled: boolean;
  onPick: (text: string) => void;
};

export const SuggestionChips = ({
  characterId,
  conversationId,
  disabled,
  version,
  enabled,
  onPick,
}: SuggestionChipsProps) => {
  // 取った候補は取った時の version と対で持つ。取った後で version が進んだ
  // （枝操作など）場合、古い場面の候補を新しい返事の下に出さんようする。
  const [suggestions, setSuggestions] = useState<{ items: string[]; version: string } | null>(null);
  const [failed, setFailed] = useState(false);
  // 閉じた候補は次の返事まで出さん。version の変化で閉じた印を外す。
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  // 「もう一度」は取り直しの回数を上げて effect をもう一度走らせる。
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setSuggestions(null);
      return;
    }
    if (!conversationId || disabled) return;
    const abort = new AbortController();
    const askedVersion = version;
    setFailed(false);
    void fetchSuggestions(characterId, conversationId, abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) setSuggestions({ items, version: askedVersion });
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
    // version で「返事が進んだ」だけを見る。suggestions 自体は依存に入れん。
  }, [characterId, conversationId, version, enabled, disabled, attempt]);

  if (!enabled) return null;

  if (failed) {
    // 板 TalkError「返事の候補を出せなかった時」。失敗は流れの中の静かな 1 行。
    return (
      <div className="v2-suggestions v2-suggestions-failed">
        <span>候補を出せませんでした</span>
        <button
          type="button"
          onClick={() => {
            setSuggestions(null);
            setDismissedAt(null);
            setAttempt((count) => count + 1);
          }}
        >
          もう一度
        </button>
      </div>
    );
  }

  const visible =
    suggestions !== null &&
    suggestions.items.length > 0 &&
    suggestions.version === version &&
    dismissedAt !== version
      ? suggestions.items
      : null;
  if (visible === null) return null;

  return (
    <div className="v2-suggestions">
      {visible.map((text, index) => (
        <button
          key={index}
          type="button"
          className="v2-suggestion-chip"
          disabled={disabled}
          onClick={() => {
            setSuggestions(null);
            onPick(text);
          }}
        >
          {text}
        </button>
      ))}
      <button
        type="button"
        className="v2-suggestion-close"
        aria-label="候補を閉じる"
        onClick={() => setDismissedAt(version)}
      >
        <TalkIcon name="close" />
      </button>
    </div>
  );
};
