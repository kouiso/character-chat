import { describe, expect, it } from "vitest";

import { countUiVisibleChars } from "../../../src/lib/quality-guard";
import { truncateOverlongFallback } from "../lib/route-context";

// 2026-08-20 の phase66 通読が表 2 #4（破損）で落とした 3 本は、どれもタグは正しく閉じとるのに
// 地の文が単語の途中で終わっとった。「二人の影がくっ…」「ふと自分の指が、あ…」
// 「腰を深く沈めた瞬間、きみ…」。
//
// 5 アーム 100 ターンを数えたら 7 本あって、**7 本とも可視 1069〜1159 字**やった。
// medium の上限 1200 の直下や。つまりモデルが途中で止まったんやのうて、
// **上限の切り詰めが単語の途中で切っとる。**
//
// 仕組み: keepBlocksWithinLimit は入り切らんブロックを落とすが、最後の 1 つだけ
// 残りの予算で切る。予算が 10 字くらいしか無いと trimToSentenceBoundary の中に
// 文末記号が 1 つも入らんので、素の位置で切って「…」を足す。
// 出来るのは中身の無い数文字の切れ端で、読み手には壊れて見えるだけや。
//
// しかも当たっとるのは**いちばん長い＝やっと床を超えたターン**。
// 一番ええ本文を、上限の処理が壊しとった。

const sentence = (index: number) => `${index}つめの波が奥から押し寄せて、腰の裏が甘く痺れていく。`;

// ブロックの末尾が「…」で、その直前が文末記号やない ＝ 単語の途中で切れとる。
const MID_WORD_CUT = /[^\s。」』！？]…+<\/(action|dialogue|scene|narration)>/;

describe("上限の切り詰めが単語の途中で切らん", () => {
  // 心の声は先に席を取る（keepBlocksWithinLimit）。その分だけ本編の予算が減るので、
  // 「文が 1 つ入る」下限にも足しておかんと、下限の側が間違う。
  const INNER = "こんなの知らない。";
  const BODY =
    `<response><action>${sentence(1)}${sentence(2)}</action>` +
    `<dialogue>「もっと、奥まで来て」</dialogue>` +
    `<action>${sentence(3)}${sentence(4)}</action>` +
    `<inner>${INNER}</inner></response>`;

  it("文が 1 つでも入る上限なら、どの値でも切れ端で終わらん", () => {
    // 1 つも入らん時だけは空の吹き出しを避けるために切れ端を残す仕様なので、
    // 「文 1 つは入る」以上の上限を全部当たる。
    for (let limit = sentence(1).length + INNER.length; limit < 200; limit += 1) {
      expect(truncateOverlongFallback(BODY, limit), `limit=${limit}`).not.toMatch(MID_WORD_CUT);
    }
  });

  it("1 つも入らん時は、空の吹き出しを避けるために切れ端を残す", () => {
    expect(countUiVisibleChars(truncateOverlongFallback(BODY, 8))).toBeGreaterThan(0);
  });

  it("入り切る本文には触らん", () => {
    expect(truncateOverlongFallback(BODY, 10_000)).toBe(BODY);
  });
});
