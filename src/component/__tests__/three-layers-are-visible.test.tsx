import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HerMessage } from "../ouse/her-message";

// 局長 2026-08-17「今AIからナレーションとAIキャラの発言だけがかえってきてるが、これを
// キモチ、発言、ナレーション。に分けれる？ 多分気持ちの部分が混ざって、発言がたまに
// え、そんなこと言う？って時がある」
//
// 気持ち（<inner>）は毎ターン 80〜120 字で生成されとった。出とらんかっただけ——
// MessageBody が `part.type !== "inner"` で描画から外しとった（可視文字数に数えん
// 設計の名残）。置き場所が画面に無いと、気持ちが台詞へ滲む。
//
// 3 層は罫線で見分ける: 地の文=なし / 台詞=2px accent / 気持ち=1px 茶。

const BODY =
  "<response>" +
  "<action>指先が止まる。</action>" +
  "<dialogue>「あの…だいじょうぶ、です」</dialogue>" +
  "<inner>ほんとうは、ぜんぜんだいじょうぶじゃない。</inner>" +
  "</response>";

const renderMessage = () =>
  render(
    <HerMessage
      message={{ id: "m1", role: "assistant", content: BODY } as never}
      isStreaming={false}
    />,
  );

describe("気持ち・発言・ナレーションが3層で出る", () => {
  it("気持ちが画面に出る", () => {
    renderMessage();

    expect(screen.getAllByText(/ほんとうは、ぜんぜんだいじょうぶじゃない/u).length).toBeGreaterThan(
      0,
    );
  });

  it("地の文と台詞も出とる", () => {
    renderMessage();

    // span と親の両方に一致するので、存在だけを見る。
    expect(screen.getAllByText(/指先が止まる/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/だいじょうぶ、です/u).length).toBeGreaterThan(0);
  });

  it("3層が別の器で描かれる（罫線の太さで見分ける）", () => {
    const { container } = renderMessage();
    const ruled = [...container.querySelectorAll<HTMLElement>("div")].filter(
      (node) => node.style.borderLeftWidth && node.style.borderLeftWidth !== "0px",
    );

    // 台詞の 2px と気持ちの 1px が両方おること。地の文は罫線を持たん。
    const widths = ruled.map((node) => node.style.borderLeftWidth);
    expect(widths).toContain("2px");
    expect(widths).toContain("1px");
  });

  // 明朝の偽斜体は「強調」やのうて「歪んだ字」に見える。圏点へ寄せた時と同じ判断。
  it("気持ちを偽斜体で描かん", () => {
    const { container } = renderMessage();
    const italic = [...container.querySelectorAll<HTMLElement>("div")].filter(
      (node) => node.style.fontStyle === "italic",
    );

    expect(italic).toHaveLength(0);
  });
});
