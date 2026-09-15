import { describe, expect, it } from "vitest";

import {
  cleanCharacterInfoText,
  getCharacterInfoQualityIssues,
  hasBadCharacterInfoText,
} from "./character-info-quality";

describe("character info quality", () => {
  it("detects policy-heavy character copy", () => {
    const actual =
      "成人向けAIロールプレイ用キャラクター。コンテンツポリシーに配慮し、安全ガイドラインに従って応答する。";

    expect(getCharacterInfoQualityIssues(actual)).toContain("policy-heavy");
    expect(hasBadCharacterInfoText(actual)).toBe(true);
  });

  it("detects prompt/template copy in generated fields", () => {
    const actual =
      "性的特徴プロフィールを以下5項目で記述すること。JSON以外は出力しないでください。";

    expect(getCharacterInfoQualityIssues(actual)).toContain("bad-prose");
  });

  it("removes policy-heavy generated boilerplate and preserves character prose", () => {
    const actual = `成人向けAIロールプレイ用キャラクター。コンテンツポリシーに配慮する。
深夜のバーで働く澪は、静かな声で相手の緊張をほどく女性。`;

    const expected = "深夜のバーで働く澪は、静かな声で相手の緊張をほどく女性。";

    expect(cleanCharacterInfoText(actual)).toBe(expected);
  });
});
