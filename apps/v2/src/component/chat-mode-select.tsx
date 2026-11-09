import { useEffect, useState } from "react";

// チャットモード切替（RIT-205）。保存先は /api/settings（D1 が正本）。
// quality=長め・重いモデル、standard=既定、light=短め・軽いモデル。次のターンから効く。
const CHAT_MODE_OPTIONS = [
  { value: "quality", label: "高品質（長め・重いモデル）" },
  { value: "standard", label: "標準" },
  { value: "light", label: "軽量（短め・軽いモデル）" },
] as const;
type ChatModeValue = (typeof CHAT_MODE_OPTIONS)[number]["value"];

const isChatModeValue = (v: unknown): v is ChatModeValue =>
  CHAT_MODE_OPTIONS.some((option) => option.value === v);

export const ChatModeSelect = () => {
  const [mode, setMode] = useState<ChatModeValue>("standard");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("read failed"))))
      .then((body: unknown) => {
        const value =
          body !== null && typeof body === "object" && "chatMode" in body
            ? body.chatMode
            : undefined;
        if (isChatModeValue(value)) setMode(value);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const change = async (next: ChatModeValue) => {
    const prev = mode;
    setMode(next);
    setFailed(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatMode: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setMode(prev);
      setFailed(true);
    }
  };

  return (
    <section className="v2-chat-mode">
      <label>
        チャットモード
        <select
          value={mode}
          disabled={!loaded}
          onChange={(event) => {
            if (isChatModeValue(event.target.value)) void change(event.target.value);
          }}
        >
          {CHAT_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {failed && <p role="alert">設定の読み書きに失敗しました。</p>}
    </section>
  );
};
