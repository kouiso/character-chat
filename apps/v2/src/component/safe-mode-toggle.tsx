import { useEffect, useState } from "react";

// セーフ/アンリミテッドの切替（RIT-199）。保存先は /api/settings（D1 が正本）。
// ON はアダルト応答を返さん安全側モデルチェーンへ切り替わる。次のターンから効く。
export const SafeModeToggle = () => {
  const [safeMode, setSafeMode] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("read failed"))))
      .then((body: unknown) => {
        setSafeMode(
          body !== null && typeof body === "object" && "safeMode" in body
            ? body.safeMode === true
            : false,
        );
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const toggle = async () => {
    const next = !safeMode;
    setSafeMode(next);
    setFailed(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ safeMode: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setSafeMode(!next);
      setFailed(true);
    }
  };

  return (
    <section className="v2-safe-mode">
      <label>
        <input
          type="checkbox"
          checked={safeMode}
          disabled={!loaded}
          onChange={() => void toggle()}
        />
        セーフモード（アダルト表現を出さない）
      </label>
      {failed && <p role="alert">設定の読み書きに失敗しました。</p>}
    </section>
  );
};
