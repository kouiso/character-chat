import { describe, expect, it } from "vitest";

import { findCrossTurnRepetitionMatch, runQualityChecks } from "../quality-guard";
import { buildHintForCategory } from "../quality-retry-hints";

// 実測 2026-08-17 phase8: 霜月鈴の 10 ターン中 7 ターンが cross-turn repetition で落ちた。
// 再掲されとったのは丸ごとの身体描写句——「きみの腰に足を絡め」「きみのシャツの裾を捲り上げ」
// 「ベッドサイドのライトがきみの睫毛を長く伸ばし」。3 回撮り直しても同じ句が戻り、
// 最後は fallback で配られた。
//
// リトライ指示が渡しとったのは、前ターン本文の先頭 120 字の抜粋と、応答の中で
// 2 回以上出た句だけ。**どの句を前のターンから持ってきたか**は一度も伝えとらんかった。
// モデルは何を避ければええか分からんまま撮り直しとった。

const turn = (action: string, dialogue: string) =>
  `<response><action>${action}</action><dialogue>${dialogue}</dialogue>` +
  `<inner>まだ足りない。</inner></response>`;

const previous = turn(
  "きみの腰に足を絡め、逃げ場を塞ぐ。きみのシャツの裾を捲り上げ、汗ばんだ腹に掌を這わせる。" +
    "ベッドサイドのライトがきみの睫毛を長く伸ばし、影が頬で揺れる。",
  "「……逃がさないって、言ったでしょ」",
);
const repeated = turn(
  "きみの腰に足を絡め、体重を預ける。きみのシャツの裾を捲り上げ、指を滑らせる。" +
    "ベッドサイドのライトがきみの睫毛を長く伸ばし、瞬きのたびに揺れる。",
  "「……まだ、終わらせない」",
);

describe("ターンを跨いで再掲された句を名指しする", () => {
  it("findCrossTurnRepetitionMatch が再掲された句そのものを返す", () => {
    const match = findCrossTurnRepetitionMatch(repeated, previous, [previous]);

    expect(match.isDuplicate).toBe(true);
    expect(match.repeatedPhrases).toEqual(
      expect.arrayContaining(["きみの腰に足を絡め", "きみのシャツの裾を捲り上げ"]),
    );
  });

  it("再掲が無ければ句も返さん", () => {
    const fresh = turn("窓の外で雨脚が強まる。", "「……傘、持ってないでしょ」");

    expect(
      findCrossTurnRepetitionMatch(fresh, previous, [previous]).repeatedPhrases,
    ).toBeUndefined();
  });

  it("runQualityChecks が再掲句を結果へ載せる", () => {
    const result = runQualityChecks(repeated, {
      phase: "erotic",
      characterName: "霜月鈴",
      prevAssistantResponse: previous,
      prevAssistantResponses: [previous],
    });

    expect(result.failedCheck).toBe("cross-turn-repetition");
    expect(result.crossTurnRepeatedPhrases).toEqual(expect.arrayContaining(["きみの腰に足を絡め"]));
  });

  it("リトライ指示が再掲句を名指しする", () => {
    const hint = buildHintForCategory("repetition", {
      phase: "erotic",
      crossTurnRepeatedPhrases: ["きみの腰に足を絡め", "きみのシャツの裾を捲り上げ"],
    });

    expect(hint).toContain("きみの腰に足を絡め");
    expect(hint).toContain("きみのシャツの裾を捲り上げ");
  });

  // 名指しが無い時に文言が壊れんこと。
  it("再掲句が無ければ従来の文言のまま", () => {
    const hint = buildHintForCategory("repetition", {
      phase: "erotic",
      repeatedTokens: ["同じ喘ぎ"],
    });

    expect(hint).toContain("同じ喘ぎ");
  });
});
