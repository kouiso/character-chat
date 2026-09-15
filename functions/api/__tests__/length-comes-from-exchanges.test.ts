// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolvePhaseAwareResponseLength } from "../lib/route-context";

// 実測 phase38 / phase40 / phase41: 同じ指示ブロックの中で「1 つのタグに行を積み上げん」と
// 言うた直後に「複数段落で積み上げる」と言うとった。字数の行き先が段落しか示されてへんと、
// 長さを求められた瞬間に交互が負ける（可視 1092〜1131 字のターンは全部 1 組へ潰れた）。
//
// 定数の文字列だけを見るテストやと、配線から外れても緑のままになる。実際に長さを解決させて、
// モデルへ渡る hint の中身を見る。

const PARAGRAPH_PRESSURE = ["複数段落で積み上げ", "複数段落でじっくり"];

const hintFor = (phase: "erotic" | "climax" | "intimate" | "afterglow", veryLong: boolean) =>
  resolvePhaseAwareResponseLength(phase, veryLong ? "very_long" : "medium", 20);

describe("長さの行き先は段落やのうてやりとり", () => {
  it.each([
    ["erotic", false],
    ["climax", false],
    ["intimate", false],
    ["afterglow", false],
    ["erotic", true],
    ["climax", true],
  ] as const)("%s (very_long=%s) が段落を積めと言わん", (phase, veryLong) => {
    const resolved = hintFor(phase, veryLong);
    const hint = JSON.stringify(resolved);
    for (const phrase of PARAGRAPH_PRESSURE) {
      expect(hint).not.toContain(phrase);
    }
  });

  // 積むなと言うだけやと長さの行き場が消える（phase38 で erotic が 1126 → 546 に落ちた）。
  it.each([
    ["erotic", false],
    ["climax", false],
  ] as const)("%s はやりとりを重ねろと言う", (phase, veryLong) => {
    expect(JSON.stringify(hintFor(phase, veryLong))).toContain("やりとりを重ねて");
  });

  it.each([
    ["erotic", false],
    ["climax", false],
    ["erotic", true],
    ["climax", true],
  ] as const)("%s (very_long=%s) は交互の指示を保っとる", (phase, veryLong) => {
    expect(JSON.stringify(hintFor(phase, veryLong))).toContain("交互");
  });
});
