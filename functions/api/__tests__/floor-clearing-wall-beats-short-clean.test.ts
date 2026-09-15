import { describe, expect, it } from "vitest";

import { isDemotingQualityFailure } from "../../../src/lib/quality-guard";

// 実測 2026-08-20 phase58/59: 抜き所の 5 ターンが、続き書きでフロアを超えた本文
// （可視 1051〜1150）を作った上で、402〜616 字の短い試行を配っとった。
// 落としとった唯一のチェックが body-wall で、他の反復系は既に免除に入っとった。
describe("配る試行を選ぶ時の降格", () => {
  it("壁は降格させん（長い本文をそのまま配る方が読み手の得になる）", () => {
    expect(isDemotingQualityFailure("body-wall")).toBe(false);
  });

  // 過去に「長い壁は短い抜けより読めん」で降格側へ置いた本文は、末尾の <inner> ごと
  // 落ちとった。そっちは inner-missing で降格が保たれる。ここを外して素通りにせん。
  it("<inner> 落ち・別キャラ化・XML 破損は今までどおり降格させる", () => {
    for (const check of [
      "inner-missing",
      "action-missing",
      "other-character-name",
      "xml-tags-unbalanced",
      "user-leak",
      "no-english",
    ]) {
      expect(isDemotingQualityFailure(check)).toBe(true);
    }
  });
});
