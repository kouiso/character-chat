import { useEffect, useState } from "react";

// キャラからの話しかけの入切。保存先は /api/proactive/characters/:id/settings（DO が正本）。
const endpoint = (characterId: string) =>
  `/api/proactive/characters/${encodeURIComponent(characterId)}/settings`;

export const ProactiveToggle = ({ characterId }: { characterId: string }) => {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint(characterId), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("read failed"))))
      .then((body: unknown) => {
        const settings =
          body !== null && typeof body === "object" && "settings" in body ? body.settings : null;
        setEnabled(
          settings !== null && typeof settings === "object" && "enabled" in settings
            ? settings.enabled === true
            : false,
        );
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [characterId]);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    setFailed(false);
    const res = await fetch(endpoint(characterId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setEnabled(!next);
      setFailed(true);
    }
  };

  return (
    <label className="v2-proactive-toggle">
      <input type="checkbox" checked={enabled} disabled={!loaded} onChange={() => void toggle()} />
      キャラから話しかける
      {failed && <span role="alert">（保存に失敗しました）</span>}
    </label>
  );
};
