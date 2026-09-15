import { describe, expect, it } from "vitest";

import { parseXmlResponse } from "../../../src/lib/xml-response-parser";
import {
  REPETITION_TRIM_MIN_KEPT_RATIO,
  applyRetryExhaustionFallback,
  trimRepetitionFallback,
} from "../lib/route-context";

import type { QualityFailure } from "../../../src/lib/quality-guard";

// 実測 2026-08-18 phase32 Sakura t7→t8。長さで落ちたターンに前ターンの貼り直しが混ざる形。
const REPEATED = "あなたの指がニットの裾を捲り上げる";
const RESPONSE = [
  "<response>",
  `<action>${REPEATED}。冷たい空気が腹の皮膚に触れて、息が止まりかける。</action>`,
  "<dialogue>「そこ、だめです…声、出ちゃう」</dialogue>",
  "<action>膝が笑って、あなたの腕にしがみつく。指先が布地に食い込む。</action>",
  "<dialogue>「もう、立っていられません…」</dialogue>",
  "<action>耳の裏に息がかかって、背中が跳ねる。汗がうなじを伝う。</action>",
  "<dialogue>「お願い、離さないでください」</dialogue>",
  "<inner>頭が真っ白になる。</inner>",
  "</response>",
].join("");

const failure = (failedCheck: string, phrases?: string[]): QualityFailure => ({
  failedCheck,
  category: "repetition",
  crossTurnRepeatedPhrases: phrases,
});

describe("撮り直しが尽きた後の修復", () => {
  it("一次が長さ不足でも、二次で落ちた貼り直しの修復が走る", () => {
    const repaired = applyRetryExhaustionFallback(
      RESPONSE,
      "long-response-too-short",
      undefined,
      [failure("cross-turn-repetition", [REPEATED]).failedCheck],
      [REPEATED],
    );

    expect(repaired).not.toContain(REPEATED);
    expect(repaired).toContain("もう、立っていられません");
  });

  it("指摘が長さ不足だけなら本文はそのまま", () => {
    expect(applyRetryExhaustionFallback(RESPONSE, "long-response-too-short")).toContain(REPEATED);
  });

  it("同じ理由を二重に渡しても壊れん", () => {
    const once = applyRetryExhaustionFallback(
      RESPONSE,
      "cross-turn-repetition",
      undefined,
      [],
      [REPEATED],
    );
    const twice = applyRetryExhaustionFallback(
      RESPONSE,
      "cross-turn-repetition",
      undefined,
      ["cross-turn-repetition"],
      [REPEATED],
    );
    expect(twice).toBe(once);
  });
});

describe("trimRepetitionFallback", () => {
  it("前ターンから貼り直した文を落とす", () => {
    const trimmed = trimRepetitionFallback(RESPONSE, [REPEATED]);
    expect(trimmed).not.toContain(REPEATED);
    expect(trimmed).toContain("耳の裏に息がかかって");
  });

  it("半分より多く削るぐらいなら、貼り直しが残った本文を出す", () => {
    const mostlyRepeated = [
      "<response>",
      `<action>${REPEATED}。${REPEATED}。${REPEATED}。</action>`,
      "<dialogue>「あ」</dialogue>",
      "</response>",
    ].join("");

    expect(trimRepetitionFallback(mostlyRepeated, [REPEATED])).toBe(mostlyRepeated);
    expect(REPETITION_TRIM_MIN_KEPT_RATIO).toBeGreaterThan(0);
  });

  it("再掲句を渡さん時は今までどおり同じ本文の中の重複だけ消す", () => {
    expect(trimRepetitionFallback(RESPONSE)).toContain(REPEATED);
  });

  // 生の文字列を文で切って落とすと、落とした一片に開始タグが乗って XML が壊れる。
  // 実際にそうなって `<response>` と `<action>` が消え、1 文目が裸で残った。
  it("落とす句がブロックの先頭でも、タグを道連れにせん", () => {
    const headOfBlock =
      "<response>" +
      `<action>${REPEATED}。指先が布地に食い込んで、息が浅くなる。</action>` +
      "<dialogue>「そこ、だめです」</dialogue>" +
      "<inner>頭が真っ白になる。</inner>" +
      "</response>";

    const trimmed = trimRepetitionFallback(headOfBlock, [REPEATED]);

    expect(trimmed.startsWith("<response>")).toBe(true);
    expect(trimmed).toContain("<action>指先が布地に食い込んで");
    expect(trimmed).not.toContain(REPEATED);
    const parsed = parseXmlResponse(trimmed);
    expect(parsed?.action).toContain("指先が布地に食い込んで");
    expect(parsed?.dialogue).toContain("そこ、だめです");
  });

  it("同一応答内で台詞が重なっても、閉じ括弧だけの吹き出しを配らん", () => {
    // 文の切り方が (?<=[。！？\n]) なので、「…もういいから。」は
    // 「…もういいから。 と 」 に割れる。前半が重複で落ちると閉じ括弧だけが残り、
    // <dialogue>」</dialogue> がそのまま UI へ配られとった。この関数の先頭コメントが
    // 「空に近い吹き出しを配るのが一番あかん（#975）」と書いとる、まさにその事故。
    // 50% の歯止めは全体の分量で見とるので、1 文字の吹き出しは素通りする。
    const line = "<dialogue>「…まあ、いいけど、もういいから。」</dialogue>";
    const doubled =
      "<response>" +
      "<action>薄暗い部屋の隅で、彼女はゆっくりと顔を上げ、こちらを見つめてきた。</action>" +
      line +
      "<action>指先が震えているのを隠すように、袖口をぎゅっと握りしめる。</action>" +
      line +
      "<inner>本当は行かないでほしいなんて、口が裂けても言えるわけがない。</inner>" +
      "</response>";

    const trimmed = trimRepetitionFallback(doubled);

    expect(trimmed).not.toContain("<dialogue>」</dialogue>");
    // 落とすのは重なった二つ目だけで、一つ目の台詞は残す。
    expect(trimmed).toContain("「…まあ、いいけど、もういいから。」");
  });

  it("全部落ちるぐらいなら元の本文を返す（空の吹き出しを作らん）", () => {
    const allRepeated = `<response><action>${REPEATED}。</action></response>`;
    expect(trimRepetitionFallback(allRepeated, [REPEATED])).toBe(allRepeated);
  });
});
