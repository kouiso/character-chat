import { describe, expect, it } from "vitest";

import { countUiVisibleChars } from "../../../src/lib/quality-guard";
import {
  preferNextAttemptForFloor,
  rescueDeadlineContinuation,
  salvageCompletedBlocks,
} from "../lib/route-context";

// issue #1495 §6-1 の漏斗（doc/dogfood/vlong-2026-08-20.md §28）:
// 続き書きを準備した 27 回のうち 4 回は、合流する前に締切・回数切れで終わっとる。
// 締切枝は collected.partialText を salvageCompletedBlocks へ通すだけで、
// **その周回で組んどった continuationBase を一度も見ん**。
// 続き書きの本文は「前回の続き」やから、単体では短いし前置きも無い。
// base と足せばフロアを超える分量が手元にあるのに、足さんまま短い attempt 0 が配られとった。
//
// route-context.ts:1255-1260 のコメントが同じ事故を実測で記録しとる
// （phase60: 610 字の続き書きを用意して締切、配ったのは attempt 0 の 525 字）。

// 合流は同じ文を畳むので、水増しやのうて 1 文ずつ違う文で嵩を作る。
// 実測のフロア（erotic 820 可視文字）を跨がせるために、base と続き書きの両方を
// 単体では届かん長さにしてある。
const PARTS = [
  "指先",
  "手のひら",
  "唇",
  "舌",
  "膝",
  "内腿",
  "腰",
  "背中",
  "首筋",
  "耳たぶ",
  "鎖骨",
  "髪",
  "爪",
  "喉",
  "瞼",
  "つま先",
  "脇腹",
  "太腿",
  "肩",
  "指の付け根",
];
const line = (index: number) =>
  `${PARTS[index % PARTS.length]}が震えて、濡れた音が${index}つぶん重なって耳の奥へ落ちていく。`;
const block = (from: number, count: number) =>
  `<action>${Array.from({ length: count }, (_, offset) => line(from + offset)).join("")}</action>`;

// フロアに届かん base。これが今まで配られとった方。
const BASE = `<response>
${block(0, 7)}
${block(7, 7)}
<dialogue>…そこ、だめ。声、出ちゃう。</dialogue>
<inner>こんな顔、誰にも見せたことがない。</inner>
</response>`;

// 締切で切られた続き書き。完走したブロックだけが手元に残る。
const PARTIAL_CONTINUATION = `<action>汗ばんだ内腿へ手のひらを滑らせると、しっとりした肌が指の腹に吸いつく。</action>
<dialogue>ん、っ…もっと、奥まで来て。</dialogue>
${block(14, 7)}
${block(21, 7)}
<action>切れかけの途中で終わっ`;

describe("締切で畳んだ続き書きを、base と合流させてから配る", () => {
  it("前提: 続き書き単体では今までどおり救えるが、フロアには届かん", () => {
    const salvaged = salvageCompletedBlocks(PARTIAL_CONTINUATION);
    expect(salvaged).not.toBeNull();
    expect(countUiVisibleChars(salvaged ?? "")).toBeLessThan(820);
    expect(countUiVisibleChars(BASE)).toBeLessThan(820);
  });

  it("base と合流させるとフロアを超える", () => {
    const rescued = rescueDeadlineContinuation(PARTIAL_CONTINUATION, BASE, true);
    expect(rescued).not.toBeNull();
    expect(countUiVisibleChars(rescued ?? "")).toBeGreaterThanOrEqual(820);
    // base の中身が残っとること（続き書きだけで置き換えとらん）
    expect(rescued).toContain("こんな顔、誰にも見せたことがない");
    // 続き書きの中身も入っとること
    expect(rescued).toContain("汗ばんだ内腿へ手のひらを滑らせると");
    // 切れかけのブロックは入らん
    expect(rescued).not.toContain("切れかけの途中で終わっ");
  });

  it("合流した本文は、短い base に選別で勝つ", () => {
    const rescued = rescueDeadlineContinuation(PARTIAL_CONTINUATION, BASE, true) ?? "";
    expect(
      preferNextAttemptForFloor({
        nextDistinct: countUiVisibleChars(rescued),
        currentDistinct: countUiVisibleChars(BASE),
        nextVisible: countUiVisibleChars(rescued),
        currentVisible: countUiVisibleChars(BASE),
        minChars: 820,
        nextReadable: true,
        currentReadable: true,
        isVeryLongResponse: false,
      }),
    ).toBe(true);
  });

  it("続き書きやない周回（base が無い）は今までどおり救うだけ", () => {
    const rescued = rescueDeadlineContinuation(PARTIAL_CONTINUATION, undefined, false);
    expect(rescued).toBe(salvageCompletedBlocks(PARTIAL_CONTINUATION));
  });

  it("救える完走ブロックが無い時は null", () => {
    expect(rescueDeadlineContinuation("<action>途中で切れ", BASE, true)).toBeNull();
    expect(rescueDeadlineContinuation(undefined, BASE, true)).toBeNull();
  });
});
