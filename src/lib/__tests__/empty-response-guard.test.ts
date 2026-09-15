import { describe, expect, it } from "vitest";

import { hasReadableResponseContent } from "../quality-guard";

// タグの形は揃っとるのに全セクションが空、という返事が本番の記録に8件残っとった
// （採用済み応答9,015件の再集計・2026-07-27）。品質ガード自体は action-missing で
// 弾いとったが、リトライを使い切った後の fallback が「一番長い試行」を無条件で配信
// するため、全試行が空やと空の吹き出しがそのまま画面へ出る。

describe("hasReadableResponseContent", () => {
  it("全セクションが空なら中身無しと判定する", () => {
    expect(
      hasReadableResponseContent(
        "<response><action></action><dialogue></dialogue><inner></inner></response>",
      ),
    ).toBe(false);
  });

  it("空白と改行だけでも中身無しと判定する", () => {
    expect(
      hasReadableResponseContent(
        "<response><action>   </action><dialogue>\n\n</dialogue><inner> </inner></response>",
      ),
    ).toBe(false);
  });

  it("dialogue だけでも文字が在れば中身在りと判定する", () => {
    expect(
      hasReadableResponseContent(
        "<response><action></action><dialogue>「うん。」</dialogue><inner></inner></response>",
      ),
    ).toBe(true);
  });

  it("通常の返事は中身在りと判定する", () => {
    expect(
      hasReadableResponseContent(
        "<response><action>肩をすくめる。</action><dialogue>「そうやね。」</dialogue><inner>ちょっと嬉しい。</inner></response>",
      ),
    ).toBe(true);
  });

  it("XMLやない素のテキストは、文字が在れば中身在りと判定する", () => {
    expect(hasReadableResponseContent("ただの日本語の返事です。")).toBe(true);
    expect(hasReadableResponseContent("   ")).toBe(false);
  });
});

describe("止め過ぎん", () => {
  it("セクションが空でもタグの外に本文が在れば中身在りと判定する", () => {
    expect(
      hasReadableResponseContent(
        "外に書かれた本文。<response><action></action><dialogue></dialogue><inner></inner></response>",
      ),
    ).toBe(true);
  });
});
