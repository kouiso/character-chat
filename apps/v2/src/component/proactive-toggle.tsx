import { useEffect, useState } from "react";

import { subscribeToPush, unsubscribeFromPush, type PushSubscribeResult } from "../lib/push";

// キャラからの話しかけの入切。保存先は /api/proactive/characters/:id/settings（DO が正本）。
const endpoint = (characterId: string) =>
  `/api/proactive/characters/${encodeURIComponent(characterId)}/settings`;

const PUSH_NOTE: Partial<Record<PushSubscribeResult, string>> = {
  // 通知を拒否していてもアプリ内には届く。画面の中だけで分かるよう理由を出す。
  denied: "（通知は拒否されています。アプリを開いている間だけ届きます）",
  unsupported: "（この端末・ブラウザでは通知に対応していません）",
  unavailable: "（この環境では通知は未設定です）",
};

export const ProactiveToggle = ({ characterId }: { characterId: string }) => {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pushNote, setPushNote] = useState<string | null>(null);

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
    setPushNote(null);
    const res = await fetch(endpoint(characterId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setEnabled(!next);
      setFailed(true);
      return;
    }
    // 話しかけの着信は Web Push。入にした時だけ購読を試し、結果の理由を欄内に出す。
    if (next) {
      const result = await subscribeToPush();
      const note = PUSH_NOTE[result];
      if (note) setPushNote(note);
    } else {
      await unsubscribeFromPush();
    }
  };

  return (
    <label className="v2-proactive-toggle">
      <input type="checkbox" checked={enabled} disabled={!loaded} onChange={() => void toggle()} />
      キャラから話しかける
      {failed && <span role="alert">（保存に失敗しました）</span>}
      {pushNote && <span role="status">{pushNote}</span>}
    </label>
  );
};
