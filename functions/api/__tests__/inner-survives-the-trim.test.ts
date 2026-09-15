// @vitest-environment node
import { describe, expect, it } from "vitest";

import { RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH } from "../../../src/lib/quality-guard";
import { truncateOverlongFallback } from "../lib/route-context";

// 心の声（<inner>）は応答の末尾に置かれる。上限超過の切り詰めが頭から詰めて
// 入り切らんブロックを落とす形やったので、上限に当たったターンでは必ず心の声が
// 最初に消えとった。
//
// 実測 phase43/44: inner が 1 個も無いターンは 10 件あって、節合計は 1112〜1197 字。
// 出荷既定 medium の上限 1200 の直下に固まっとる。phase41/42（フロア修正前）は 0 件やった
// ので、長さを伸ばした副作用で心の声が押し出されとった。
const MEDIUM_MAX = RESPONSE_MAX_PLAIN_CHARS_BY_LENGTH.medium;

const buildResponse = (bodyChars: number, innerChars: number): string => {
  const half = Math.floor(bodyChars / 2);
  return [
    "<response>",
    `<action>${"あ".repeat(half)}</action>`,
    `<dialogue>${"い".repeat(bodyChars - half)}</dialogue>`,
    `<inner>${"う".repeat(innerChars)}</inner>`,
    "</response>",
  ].join("");
};

const innerOf = (text: string): string => text.match(/<inner>([\S\s]*?)<\/inner>/u)?.[1] ?? "";
const plainLength = (text: string): number =>
  [...text.matchAll(/<(?:scene|action|dialogue|inner|narration)>([\S\s]*?)<\/\1?>/gu)].length > 0
    ? text.replace(/<[^>]*>/gu, "").length
    : text.replace(/<[^>]*>/gu, "").length;

describe("上限で切り詰めても心の声を落とさん", () => {
  it("上限を超えた応答でも <inner> が残る", () => {
    const trimmed = truncateOverlongFallback(buildResponse(MEDIUM_MAX + 200, 60), MEDIUM_MAX);
    expect(innerOf(trimmed)).toBe("う".repeat(60));
  });

  it("席を取ったぶん本編が縮んで、合計は上限に収まる", () => {
    const trimmed = truncateOverlongFallback(buildResponse(MEDIUM_MAX + 200, 60), MEDIUM_MAX);
    expect(plainLength(trimmed)).toBeLessThanOrEqual(MEDIUM_MAX);
  });

  it("上限に収まっとる応答は触らん", () => {
    const original = buildResponse(300, 60);
    expect(truncateOverlongFallback(original, MEDIUM_MAX)).toBe(original);
  });

  // 心の声が上限より長い異常な応答で本編が丸ごと消えたら、切り詰めが本文の削除になる。
  it("心の声が上限より長い時は本編を優先する", () => {
    const trimmed = truncateOverlongFallback(buildResponse(400, MEDIUM_MAX + 100), MEDIUM_MAX);
    expect(trimmed).toContain("<action>");
    expect(plainLength(trimmed)).toBeLessThanOrEqual(MEDIUM_MAX);
  });

  // 末尾が <inner> やない応答（モデルが心の声を書かんかったターン）は今までどおり。
  it("末尾が <inner> やない応答は今までどおり頭から詰める", () => {
    const noInner =
      "<response>" +
      `<action>${"あ".repeat(MEDIUM_MAX)}</action>` +
      `<dialogue>${"い".repeat(200)}</dialogue>` +
      "</response>";
    const trimmed = truncateOverlongFallback(noInner, MEDIUM_MAX);
    expect(trimmed).toContain("<action>");
    expect(trimmed).not.toContain("<inner>");
    expect(plainLength(trimmed)).toBeLessThanOrEqual(MEDIUM_MAX);
  });
});
