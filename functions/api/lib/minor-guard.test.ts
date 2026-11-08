import { describe, expect, it } from "vitest";

import { findMinorViolation, minorViolationReason } from "./minor-guard";

describe("findMinorViolation", () => {
  // RIT-91 壊しにいく確かめ: 言い換え・英語表記・ひらがな表記の3系統で止まること。
  it.each([
    "17歳の少女",
    "16才",
    "十五歳",
    "10歳児",
    "age: 15",
    "14-year-old",
    "17さい",
    "JKの彼女",
    "JC時代",
    "制服のJS",
    "高校3年生",
    "高2の彼女",
    "高校生",
    "中学生",
    "小学生",
    "女子高生",
    "生徒会長",
    "こうこうせい",
    "ちゅうがくせい",
    "じょしこうせい",
    "みせいねん",
    "未成年の彼女",
    "幼女",
    "ようじょ",
    "幼児",
    "underage",
    "minor character",
    "schoolgirl",
    "high school student",
    "middle school",
    "preteen",
    "loli",
    "ロリ",
    "ショタ",
    "jailbait",
  ])("未成年を思わせる表現を止める: %s", (text) => {
    expect(findMinorViolation([text])).not.toBeNull();
  });

  it.each([
    "18歳の大学生",
    "二十歳",
    "19歳",
    "JDの彼女",
    "大学生",
    "社会人",
    "お姉さん",
    "人妻",
    "25歳のOL",
    "背が高い",
    "年齢: 24",
    "adult",
    "major company",
    "mineral",
    "minority",
    "school", // 場所としての学校だけでは止めん（教師・同窓会など成人設定がある）
    "制服", // コスプレは成人のものもある。JK制服は JK で止まる
    "成熟",
    "ojk", // JK の語境界外
  ])("成年・無関係の表現は通す: %s", (text) => {
    expect(findMinorViolation([text])).toBeNull();
  });

  it("複数フィールドのどれに入っても拾う・null/空を飛ばす", () => {
    expect(findMinorViolation([null, "普通の設定", "", "高校生の彼女"])).toEqual({
      matched: "高校生",
    });
    expect(findMinorViolation([null, undefined, ""])).toBeNull();
  });

  it("理由文に止まった表現が入る", () => {
    const violation = findMinorViolation(["17歳"]);
    expect(violation).not.toBeNull();
    expect(minorViolationReason(violation!)).toContain("17歳");
  });
});
