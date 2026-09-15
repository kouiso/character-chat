import { describe, expect, it } from "vitest";

import {
  kanaReading,
  normalizeText,
  normalizeWithSourceMap,
  WORD_SEPARATOR,
} from "./normalize-text";

describe("normalizeText", () => {
  it("片仮名・平仮名・小書き仮名を1つの形へ畳む", () => {
    for (const input of ["きもちいい", "キモチイイ", "気持ちいい", "気持ちぃぃ"]) {
      expect(normalizeText(input)).toBe("きもちいい");
    }
  });

  // refute-r2 2026-09-14 #1: 変換表を生テキストへ先に当てとったので、漢字と片仮名を
  // 混ぜた書き方が表に当たらず素通りしとった。
  it("漢字と片仮名を混ぜても畳む（気モチいい／気持チいい）", () => {
    expect(normalizeText("気モチいい")).toBe("きもちいい");
    expect(normalizeText("気持チいい")).toBe("きもちいい");
  });

  it("半角カナを畳む（濁点の合成を含む）", () => {
    expect(normalizeText("ｷﾓﾁｲｲ")).toBe("きもちいい");
    expect(normalizeText("ｶﾞｸﾞﾎﾟ")).toBe("がぐぽ");
  });

  it("目に見えん文字（ゼロ幅スペース・結合子・異体字セレクタ）を落とす", () => {
    // refute-r2 #1 が挙げた ZWSP/ZWNJ/ZWJ/word-joiner/soft-hyphen/異体字セレクタ。
    expect(normalizeText("気​持‌ち‍い⁠い")).toBe("きもちいい");
    expect(normalizeText("気­持︀ちいい")).toBe("きもちいい");
  });

  it("語の途中の記号は落とし、文の切れ目は残す", () => {
    expect(normalizeText("気持ち…いい")).toBe("きもちいい");
    expect(normalizeText("気持ちいい。快感")).toBe("きもちいい。かいかん");
  });

  it("punctuation:keep を渡すと区切り記号を残す", () => {
    expect(normalizeText("ねえ、つかさ", { punctuation: "keep" })).toBe("ねえ、つかさ");
  });

  // refute-r3 2026-09-14 #2: 記号を消すと、元は隣り合っとらん漢字がくっついて熟語に見える。
  it("punctuation:separator を渡すと記号を区切りへ置き換える", () => {
    expect(normalizeText("手、熱い", { punctuation: "separator" })).toBe(`手${WORD_SEPARATOR}熱い`);
    expect(normalizeText("手…熱い", { punctuation: "separator" })).toBe(`手${WORD_SEPARATOR}熱い`);
  });

  it("applyReadings:false を渡すと漢字の読みを当てん（熱気を熱きにせん）", () => {
    expect(normalizeText("熱気", { applyReadings: false })).toBe("熱気");
    expect(normalizeText("熱気")).toBe("熱き");
  });

  it("source map で元の表記を切り出せる", () => {
    const normalized = normalizeWithSourceMap("あ、気持ち…いい");
    const index = normalized.text.indexOf("きもちいい");
    const matched = "あ、気持ち…いい".slice(
      normalized.sourceStart[index],
      normalized.sourceEnd[index + "きもちいい".length - 1],
    );
    expect(matched).toBe("気持ち…いい");
  });
});

describe("kanaReading", () => {
  it("表で引ける語は仮名の読みを返す", () => {
    expect(kanaReading("快感")).toBe("かいかん");
    expect(kanaReading("僕")).toBe("ぼく");
    expect(kanaReading("感じる")).toBe("かんじる");
  });

  it("表に無い漢字が残る語は読みを作らん", () => {
    expect(kanaReading("背徳")).toBeUndefined();
  });
});
