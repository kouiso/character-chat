// @vitest-environment node
import { describe, expect, it } from "vitest";

import { preferNextAttemptForFloor } from "../lib/route-context";

// 実測 2026-08-19 phase42（出荷既定 medium・20 ターン）: climax のフロアは 900 字やのに
// Downer t9 が 452 字、Sakura t9 が 807 字で出荷された。どちらも撮り直しは走っとる。
// 選別が「重複を除いた分量が多い方」だけを見とって、フロアへ届いたかを見んかったので、
// 撮り直しで伸びた試行が短い試行に負けて捨てられ得る。
// フロアを見る選別のコードは在ったが if (isVeryLongResponse) の中に閉じとった。
//
// ここは「重複を除いた分量」と「フロア」が**食い違う**組み合わせだけを並べる。
// 両方の物差しが同じ答えを出す例を並べても、どっちの実装でも通ってまう。

const FLOOR = 900;

describe("preferNextAttemptForFloor", () => {
  // 分量だけで選ぶと false。フロアを見ると true。
  it("フロアへ届いた試行は、重複を除いた分量で負けとっても勝つ", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 500,
        nextVisible: 950,
        currentDistinct: 600,
        currentVisible: 600,
        minChars: FLOOR,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(true);
  });

  // 分量だけで選ぶと true。フロアを見ると false。
  it("届いた試行を、分量で勝っただけの短い試行で置き換えん", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 880,
        nextVisible: 899,
        currentDistinct: 500,
        currentVisible: 950,
        minChars: FLOOR,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(false);
  });

  // どちらも届いとる時だけ長い方。分量では next が負けとる。
  it("どちらも届いとるなら長い方を採る", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 600,
        nextVisible: 1100,
        currentDistinct: 800,
        currentVisible: 950,
        minChars: FLOOR,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(true);
  });

  // #1226 の歯止め。フロアだけを見る素朴な実装やと「長い方」で next が勝ってまう。
  it("水増しでフロアを超えただけの試行は、届いた扱いにせん", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 300,
        nextVisible: 1000,
        currentDistinct: 600,
        currentVisible: 950,
        minChars: FLOOR,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(false);
  });

  // どちらも届いてへんなら従来どおり。フロアを見る実装がここまで侵食したら回帰。
  it("どちらも届いてへんなら重複を除いた分量で選ぶ", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 500,
        nextVisible: 700,
        currentDistinct: 400,
        currentVisible: 800,
        minChars: FLOOR,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(true);
  });

  // フロアが立っとらんフェーズ（conversation/intimate の medium）は今までどおり。
  it("フロアが 0 なら長さを見ん", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 200,
        nextVisible: 2000,
        currentDistinct: 400,
        currentVisible: 400,
        minChars: 0,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(false);
  });
  // 実測 2026-08-19 phase43: 長さだけを見た版で、フロアを満たした erotic/climax 6 ターン
  // 全部から末尾の <inner> が落ちた。inner-missing は決定的チェックに在るのに、選別が
  // 長さしか見てへんので「長いが壊れとる試行」が最後まで残ってフォールバックで配られる。
  it("フロアを満たしても、長さ以外が通っとらん試行は勝たん", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 950,
        nextVisible: 1145,
        currentDistinct: 800,
        currentVisible: 950,
        minChars: FLOOR,
        nextReadable: false,
        currentReadable: true,
      }),
    ).toBe(false);
  });

  it("長さ以外が通っとらん側が現行なら、通っとる試行がフロア未満でも入れ替わる", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 800,
        nextVisible: 950,
        currentDistinct: 950,
        currentVisible: 1145,
        minChars: FLOOR,
        nextReadable: true,
        currentReadable: false,
      }),
    ).toBe(true);
  });

  // 最初はここを「従来どおり分量で選ぶ」にしとったが、敵対レビュー 2026-08-19 が
  // phase43 で再現した——フロア未満同士やと可読性が一切見られず、読めん 1140 字が
  // 読める 800 字を押しのけて撮り直し尽きの出口から配られる。穴を仕様として固めとった。
  it("どちらもフロア未満でも、読める方を採る", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 900,
        nextVisible: 890,
        currentDistinct: 600,
        currentVisible: 600,
        minChars: FLOOR,
        nextReadable: false,
        currentReadable: true,
      }),
    ).toBe(false);
  });

  it("可読性が同じなら従来どおり分量で選ぶ", () => {
    expect(
      preferNextAttemptForFloor({
        nextDistinct: 900,
        nextVisible: 890,
        currentDistinct: 600,
        currentVisible: 600,
        minChars: FLOOR,
        nextReadable: true,
        currentReadable: true,
      }),
    ).toBe(true);
  });
});

// この選別はもともと `if (isVeryLongResponse)` の中だけに在って、「フロアへ届いた方／
// 届いた者どうしは長い方」を可読性抜きで見とった。出荷既定へ広げる時にその枝ごと
// 可読性を必須にしてもうて、**very_long だけ黙って厳しくなっとった**
// （敵対レビュー 2026-08-19）。very_long は「たっぷり」の明示指定なので元の挙動へ戻す。
describe("preferNextAttemptForFloor（very_long）", () => {
  const veryLong = { minChars: FLOOR, isVeryLongResponse: true } as const;

  it("長さ以外が通っとらんでも、フロアへ届いた方を採る", () => {
    expect(
      preferNextAttemptForFloor({
        ...veryLong,
        nextDistinct: 1200,
        nextVisible: 1400,
        currentDistinct: 600,
        currentVisible: 600,
        nextReadable: false,
        currentReadable: true,
      }),
    ).toBe(true);
  });

  it("フロア未満同士でも可読性で順位を変えん", () => {
    expect(
      preferNextAttemptForFloor({
        ...veryLong,
        nextDistinct: 700,
        nextVisible: 700,
        currentDistinct: 600,
        currentVisible: 600,
        nextReadable: false,
        currentReadable: true,
      }),
    ).toBe(true);
  });
});
