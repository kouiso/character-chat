import { describe, expect, it } from "vitest";

import { checkNoForbiddenCharacterWords } from "./quality-guard";

// キャラシートの forbidden_words はパースまで済んどるのに、行き先がプロンプト 1 行だけで、
// 決定的チェックの列（checkWrongFirstPerson の隣）へ渡っとらんかった。
//
// 実測（両キャラのシートを D1 から引いて本文へ当てた）:
//   phase41 0/20 ターン / phase42 1/20（Sakura t9 = climax に「気持ちいい」「快感」）
//   phase43 3/20（Sakura t7・t8 に「快感」、t10 に「気持ちいい」）
// さくらのシートは「快感より、選ばれて溶けていく感覚が核心」やから、この 2 語を踏むと
// 通しで一番重い climax が汎用の絶頂描写になる。
//
// 語はシート由来だけを使う。コード側で語を列挙したら no-injected-ai-filter 違反になる。

const body = (action: string, dialogue: string): string =>
  `<response><action>${action}</action><dialogue>「${dialogue}」</dialogue><inner>ないしん</inner></response>`;

describe("checkNoForbiddenCharacterWords", () => {
  it("シートに無い時は何も見ん", () => {
    expect(checkNoForbiddenCharacterWords(body("快感が走る", "気持ちいい"), undefined)).toBe(true);
    expect(checkNoForbiddenCharacterWords(body("快感が走る", "気持ちいい"), [])).toBe(true);
  });

  it("台詞に出た禁止語を落とす", () => {
    expect(
      checkNoForbiddenCharacterWords(body("背中がふるえる", "気持ちいい"), ["気持ちいい"]),
    ).toBe(false);
  });

  // 実測で 3 件中 2 件は <action> 側やった（「快感が走る」）。台詞だけ見ると取り逃す。
  it("地の文に出た禁止語も落とす", () => {
    expect(checkNoForbiddenCharacterWords(body("快感が走る", "ん"), ["快感"])).toBe(false);
  });

  // <inner> も画面に出る（局長 2026-08-17 の 3 層表示・a1b9121）。禁止語が気持ちの層に
  // 出たら読み手には見えとる。「非表示やから見ん」は a1b9121 以前の前提やった。
  it("<inner> に出た禁止語も落とす", () => {
    expect(
      checkNoForbiddenCharacterWords(
        `<response><action>あ</action><dialogue>「い」</dialogue><inner>快感</inner></response>`,
        ["快感"],
      ),
    ).toBe(false);
  });

  it("禁止語が無ければ通す", () => {
    expect(
      checkNoForbiddenCharacterWords(body("背中がふるえる", "だめ"), ["快感", "気持ちいい"]),
    ).toBe(true);
  });
});

// 実経路（シート → buildServerQualityContext → runQualityChecks）は
// functions/api/__tests__/forbidden-words-reach-the-gate.test.ts で見る。
// 純関数だけ通しても届いとる保証にならん（body-wall で同じ穴を踏んだ）。
