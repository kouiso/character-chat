import { describe, expect, it } from "vitest";

import { buildSceneStateContinuity } from "../lib/route-context";

// 実測 2026-08-20 phase61: Sakura t7 は erotic で 840 字書いとるのに、進行度の語彙 12 個を
// 1 つも含まんかった。錨に進行度が乗らんかった結果、t8 は相手が「もっと」と言うたのに
// ソファへ座り直して「こんなこと初めてだから」へ戻る（intimate への巻き戻り）。
const sakuraTurn7 = [
  "<response><action>喉の奥がカラカラに渇いていて、声が出にくい。",
  "下腹の奥から知らない熱がこみ上げてくる。</action>",
  "<dialogue>「だめ…このままじゃ…わたし、本当に…変になっちゃう…」</dialogue></response>",
].join("");

const smallTalk =
  "<response><action>紅茶のカップを置いて、窓の外を見る。</action>" +
  "<dialogue>「今日は良い天気ですね」</dialogue></response>";

describe("場面の錨に乗る進行度", () => {
  it("erotic の本文から進行度を拾う", () => {
    const anchor = buildSceneStateContinuity(
      [
        { role: "user", content: "もっと" },
        { role: "assistant", content: sakuraTurn7 },
      ],
      "erotic",
    );

    expect(anchor).toContain("arousal=");
  });

  // 会話ターンで誤って進行度を立てると、何も起きとらんのに先へ進んだことにしてまう。
  it("ただの雑談からは拾わん", () => {
    const anchor = buildSceneStateContinuity(
      [
        { role: "user", content: "こんにちは" },
        { role: "assistant", content: smallTalk },
      ],
      "intimate",
    );

    expect(anchor).not.toContain("arousal=");
  });
});
