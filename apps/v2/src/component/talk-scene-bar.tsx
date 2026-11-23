import { useEffect, useState } from "react";

import { loadLedger, type LedgerData } from "../lib/ledger";
import { LedgerPanel } from "./ledger-panel";
import { TalkIcon } from "./talk-icon";
import { TalkMood } from "./talk-mood";

// 場面帯（板 Talk の 2 枚目の薬丸）。左半分は「いまの場面」シート、
// 右半分は雰囲気の切り替え（板 Mood）。雰囲気を変えたら帯も読み直す。
export const TalkSceneBar = ({
  characterId,
  conversationId,
  turn,
  busy,
}: {
  characterId: string;
  conversationId: string | null;
  turn: number;
  busy: boolean;
}) => {
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  // 雰囲気を変えた時に帯を読み直すための合図。
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    if (conversationId && !busy) {
      void loadLedger(characterId, conversationId, abort.signal)
        .then((loaded) => {
          if (!abort.signal.aborted) setLedger(loaded);
        })
        .catch(() => {});
    }
    return () => abort.abort();
  }, [characterId, conversationId, turn, busy, reloadKey]);
  const scene = ledger ? [ledger.time, ledger.location].filter(Boolean).join("・") : "";
  return (
    <div className="v2-talk-scene-bar">
      <div className="v2-talk-scene-pill">
        <LedgerPanel
          characterId={characterId}
          getConversationId={() => conversationId}
          trigger={
            <>
              <TalkIcon name="pin" />
              <span>{scene || "いまの場面"}</span>
            </>
          }
        />
        <TalkMood
          characterId={characterId}
          getConversationId={() => conversationId}
          phase={ledger?.phase ?? null}
          onChanged={() => setReloadKey((count) => count + 1)}
        />
      </div>
    </div>
  );
};
