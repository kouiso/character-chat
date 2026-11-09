import { useEffect, useState } from "react";

// 文体スタイル切替（RIT-203）。保存先は /api/settings（D1 が正本）。
// 地の文と台詞の配分を変える。モード（モデル・長さ）とは別軸。次のターンから効く。
const STYLE_OPTIONS = [
  { value: "balanced", label: "標準（地の文と台詞のバランス）" },
  { value: "prose", label: "地の文重め（描写厚め・台詞控えめ）" },
  { value: "dialogue", label: "会話重め（台詞中心・地の文短め）" },
] as const;
type StyleValue = (typeof STYLE_OPTIONS)[number]["value"];

const isStyleValue = (v: unknown): v is StyleValue =>
  STYLE_OPTIONS.some((option) => option.value === v);

export const StyleSelect = () => {
  const [style, setStyle] = useState<StyleValue>("balanced");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("read failed"))))
      .then((body: unknown) => {
        const value =
          body !== null && typeof body === "object" && "style" in body ? body.style : undefined;
        if (isStyleValue(value)) setStyle(value);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const change = async (next: StyleValue) => {
    const prev = style;
    setStyle(next);
    setFailed(false);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ style: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setStyle(prev);
      setFailed(true);
    }
  };

  return (
    <section className="v2-style">
      <label>
        文体スタイル
        <select
          value={style}
          disabled={!loaded}
          onChange={(event) => {
            if (isStyleValue(event.target.value)) void change(event.target.value);
          }}
        >
          {STYLE_OPTIONS.map((option) => (
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
