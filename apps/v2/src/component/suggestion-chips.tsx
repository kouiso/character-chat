import { useState } from "react";

import { fetchSuggestions } from "../lib/suggest";

// RIT-203: 次の発話候補の取得ボタンと候補チップ。選択肢・おすすめ返信の両方を兼ねる。
// 選んだ文は親の送信経路へ渡す（発話として送られる）。

type SuggestionChipsProps = {
  characterId: string;
  // 会話は最初の送信で初めてサーバへ作られるので、getter で最新値を読む。
  getConversationId: () => string | null;
  disabled: boolean;
  onPick: (text: string) => void;
  onError: (message: string) => void;
};

export const SuggestionChips = ({
  characterId,
  getConversationId,
  disabled,
  onPick,
  onError,
}: SuggestionChipsProps) => {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const request = () => {
    const conversationId = getConversationId();
    if (!conversationId || busy || disabled) return;
    setBusy(true);
    void fetchSuggestions(characterId, conversationId)
      .then((items) => setSuggestions(items))
      .catch((cause) => onError((cause as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      {suggestions !== null && suggestions.length > 0 && (
        <div className="v2-suggestions">
          {suggestions.map((text, index) => (
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
            onClick={() => setSuggestions(null)}
          >
            ×
          </button>
        </div>
      )}
      <button type="button" onClick={request} disabled={disabled || busy || !getConversationId()}>
        {busy ? "考え中…" : "おすすめ"}
      </button>
    </>
  );
};
