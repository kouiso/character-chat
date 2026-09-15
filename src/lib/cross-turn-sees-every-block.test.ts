import { describe, expect, it } from "vitest";

import { findCrossTurnRepetitionMatch } from "./quality-guard";

// ターン跨ぎの逐語再掲は、検出器が発火しとらんのやのうて**本文の 1/5 しか見てへん**かった。
// extractActionContent / extractDialogueContent / extractInnerContent が
// 非グローバルの .match で、1 ターンに 5〜8 個ある <action> の**1 個目しか返さん**。
//
// 壁を潰して交互に書けるようになった分、検出器の目に入らん本文が増えとった。
// 実測（同じ閾値・同じ比較で全ブロックを繋いだ場合との差）:
//   phase41  1 ブロック目のみ 0 組 → 全ブロック 3 組
//   phase42  1 ブロック目のみ 1 組 → 全ブロック 6 組
//     Sakura t2→t3 6 句 / Downer t2→t3 6 句 / Downer t7→t8 14 句

const turn = (actions: string[], dialogue: string): string =>
  `<response>${actions.map((a) => `<action>${a}</action>`).join("")}<dialogue>${dialogue}</dialogue><inner>みじかい</inner></response>`;

const REUSED_A = "指先が鎖骨の窪みをゆっくりとなぞっていく";
const REUSED_B = "息が耳のうしろにかかって背中がふるえる";

describe("findCrossTurnRepetitionMatch", () => {
  it("2 個目以降の <action> に載った逐語再掲を見つける", () => {
    const previous = turn(["まったく別の書き出しで場面をひらく", REUSED_A, REUSED_B], "「ん」");
    const current = turn(["これも別の書き出しではじまる", REUSED_A, REUSED_B], "「ぁ」");

    const match = findCrossTurnRepetitionMatch(current, previous);

    expect(match.isDuplicate).toBe(true);
    expect(match.repeatedPhrases).toEqual(expect.arrayContaining([REUSED_A, REUSED_B]));
  });

  it("2 個目以降の <dialogue> でも見つける", () => {
    const previous = `<response><dialogue>「ちがう台詞」</dialogue><action>あ</action><dialogue>「${REUSED_A}」</dialogue><dialogue>「${REUSED_B}」</dialogue></response>`;
    const current = `<response><dialogue>「これも別」</dialogue><action>い</action><dialogue>「${REUSED_A}」</dialogue><dialogue>「${REUSED_B}」</dialogue></response>`;

    expect(findCrossTurnRepetitionMatch(current, previous).isDuplicate).toBe(true);
  });

  // 書き直しで検出が甘くなっとらんことの確認。別の本文は落とさん。
  it("別の本文どうしは落とさん", () => {
    const previous = turn(
      ["雨の匂いが窓のそとから流れこんでくる", "指が髪のあいだをすべる"],
      "「ん」",
    );
    const current = turn(
      ["朝の光がカーテンの隙間で細く割れる", "掌が背中のくぼみへおりる"],
      "「ぁ」",
    );

    expect(findCrossTurnRepetitionMatch(current, previous).isDuplicate).toBe(false);
  });
});
