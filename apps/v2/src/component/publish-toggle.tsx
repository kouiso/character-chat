// RIT-206: キャラの公開/非公開トグル（本人のキャラ設定画面用）。
import { useEffect, useState } from "react";

import { readPublishStatus, setPublished, unsetPublished } from "../lib/catalog";

export const PublishToggle = ({ characterId }: { characterId: string }) => {
  const [published, setPublishedState] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void readPublishStatus(characterId, abort.signal)
      .then((status) => setPublishedState(status.published))
      .catch(() => setPublishedState(false));
    return () => abort.abort();
  }, [characterId]);

  const toggle = () => {
    if (published === null || busy) return;
    setBusy(true);
    setError(null);
    const next = !published;
    void (next ? setPublished(characterId) : unsetPublished(characterId))
      .then(() => setPublishedState(next))
      .catch((cause) => setError((cause as Error).message))
      .finally(() => setBusy(false));
  };

  if (published === null) return null;
  return (
    <span>
      <button type="button" disabled={busy} aria-pressed={published} onClick={toggle}>
        {published ? "公開をやめる" : "公開する"}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
};
