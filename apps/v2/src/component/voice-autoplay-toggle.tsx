// 応答音声の自動再生トグル（RIT-211）。保存先は /api/settings（D1 が正本）。
import { useEffect, useState } from "react";

export const VoiceAutoplayToggle = () => {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const value =
          body !== null && typeof body === "object" && "voiceAutoplay" in body
            ? body.voiceAutoplay === true
            : null;
        setOn(value);
      })
      .catch(() => setOn(null));
    return () => controller.abort();
  }, []);

  const toggle = async (next: boolean) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceAutoplay: next }),
    });
    if (res.ok) setOn(next);
  };

  return (
    <label className="voice-autoplay">
      ボイス自動再生
      <input
        type="checkbox"
        disabled={on === null}
        checked={on === true}
        onChange={(e) => void toggle(e.target.checked)}
      />
    </label>
  );
};
