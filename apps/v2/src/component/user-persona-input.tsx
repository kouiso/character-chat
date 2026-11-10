import { useEffect, useState } from "react";

// RIT-30 ギャップ（Saylo のユーザーの役割設定）: キャラから見たユーザー自身の人物像。
// 保存先は /api/settings（D1 が正本）。書いた内容は全キャラとの会話へ共通で渡る。
export const UserPersonaInput = () => {
  const [persona, setPersona] = useState("");
  const [saved, setSaved] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("read failed"))))
      .then((body: unknown) => {
        const value =
          body !== null && typeof body === "object" && "userPersona" in body
            ? body.userPersona
            : undefined;
        if (typeof value === "string") {
          setPersona(value);
          setSaved(value);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userPersona: persona }),
    }).catch(() => null);
    if (!res?.ok) {
      setFailed(true);
    } else {
      setSaved(persona);
    }
    setBusy(false);
  };

  return (
    <section className="v2-persona">
      <label>
        あなたの設定（キャラから見た自分）
        <textarea
          value={persona}
          disabled={!loaded}
          rows={3}
          maxLength={2000}
          placeholder="例: 20代の会社員。クールぶってるけど本当は優しい。呼び方は「先輩」。"
          onChange={(event) => setPersona(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!loaded || busy || persona === saved}
        onClick={() => void save()}
      >
        {busy ? "保存中…" : "保存"}
      </button>
      {failed && <p role="alert">設定の読み書きに失敗しました。</p>}
    </section>
  );
};
