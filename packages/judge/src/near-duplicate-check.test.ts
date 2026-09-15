import { describe, expect, it } from "vitest";

import { nearDuplicateCheck, splitSentences } from "./near-duplicate-check";

describe("nearDuplicateCheck", () => {
  it("直前の一文を言い換えて置いた文は反復（鈴 t7: 痕を残す → 跡を残す）", () => {
    const previous =
      "<action>口づけを解き、あなたの首筋に歯を立てる。軽く噛んで、痕を残す。チョーカーの金具が皮膚に押し付けられる。</action>";
    const text =
      "<action>あなたの首筋に歯を立てる。軽く噛んで、跡を残す。唾液が皮膚に伝わり、冷たい空気でひんやりとする。</action>";
    const result = nearDuplicateCheck(text, [previous]);
    expect(result.ok).toBe(false);
    expect(result.matches[0]?.sentence).toContain("首筋に歯を立てる");
  });

  it("同じ場面でも別の動作の文は通る", () => {
    const previous =
      "<action>口づけを解き、あなたの首筋に歯を立てる。軽く噛んで、痕を残す。</action>";
    const text =
      "<action>震える手でパーカーのジッパーを下ろし始める。湿った布が剥がれる感触に指先が震える。</action>";
    expect(nearDuplicateCheck(text, [previous]).ok).toBe(true);
  });

  it("10 字未満の短い文（相槌）は比べん", () => {
    expect(
      nearDuplicateCheck("<dialogue>「…あっ、だめ」</dialogue>", [
        "<dialogue>「…あっ、だめ」</dialogue>",
      ]).ok,
    ).toBe(true);
  });

  it("splitSentences はタグを剥がして句点で切り、短い文を落とす", () => {
    expect(
      splitSentences(
        "<action>短い。これは十字を超える文である。</action><dialogue>「はい」</dialogue>",
      ),
    ).toEqual(["これは十字を超える文である"]);
  });
});
