import { useEffect, useState } from "react";

import { loadLedger } from "../lib/ledger";
import { LedgerPanel } from "./ledger-panel";
import { TalkIcon } from "./talk-icon";

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
  const [scene, setScene] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    if (conversationId && !busy) {
      void loadLedger(characterId, conversationId, abort.signal)
        .then((ledger) => {
          if (!abort.signal.aborted)
            setScene([ledger?.time, ledger?.location].filter(Boolean).join("・") || null);
        })
        .catch(() => {});
    }
    return () => abort.abort();
  }, [characterId, conversationId, turn, busy]);
  return (
    <div className="v2-talk-scene-bar">
      <LedgerPanel
        characterId={characterId}
        getConversationId={() => conversationId}
        trigger={
          <>
            <TalkIcon name="pin" />
            <span>{scene ?? "いまの場面"}</span>
            <TalkIcon name="down" />
          </>
        }
      />
    </div>
  );
};
