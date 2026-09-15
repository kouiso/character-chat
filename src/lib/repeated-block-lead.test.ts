import { describe, expect, it } from "vitest";

import { checkNoRepeatedBlockLead } from "./quality-guard";

// 実測 2026-08-19 phase42（出荷既定 medium・20 ターン）:
//   Downer-10 は <action> 8 個が全部「きみの」で始まる
//   Downer-06 が 5 個、Downer-07 が 4 個
// phase41 でも 7 件。壁を潰して交互に書けるようになった分、
// 「同じ書き出しの段落が並ぶ」形が前より目に付くようになった。
//
// 既存の checkRepeatedVocativeLead は拾えん。あれは呼びかけ（「きみ、」「きみ…」）の
// 連投を見るもので、helper のコメントどおり「きみの背中を」は助詞が続くので主語位置＝対象外。
// 反復そのものは「出てはいけない匂い」に挙がっとる（同じ語・身体反応・段落構造の反復）。

const wrap = (blocks: string[]): string =>
  `<response>${blocks.join("")}<inner>みじかい</inner></response>`;

// parseXmlResponse は <dialogue> が無いと null を返す（会話フェーズでも台詞は必須）。
// 本番の応答は必ず台詞を持つので、fixture も同じ形にする。
const actions = (leads: string[]): string =>
  wrap([
    ...leads.map((lead, i) => `<action>${lead}に触れる${"あ".repeat(i + 1)}。</action>`),
    "<dialogue>「ん」</dialogue>",
  ]);

describe("checkNoRepeatedBlockLead", () => {
  it("同じ書き出しの <action> が 4 つ並んだら落とす", () => {
    expect(
      checkNoRepeatedBlockLead(actions(["きみの背中", "きみの肩", "きみの腰", "きみの腿"])),
    ).toBe(false);
  });

  it("3 つまでは通す（交互に書けとるターンを落とさんため）", () => {
    expect(checkNoRepeatedBlockLead(actions(["きみの背中", "きみの肩", "きみの腰"]))).toBe(true);
  });

  it("書き出しが散っとるなら何ブロックあっても通す", () => {
    expect(
      checkNoRepeatedBlockLead(
        actions(["指先が", "唇から", "膝が", "髪の毛", "背骨を", "爪先へ", "腰の奥", "喉元に"]),
      ),
    ).toBe(true);
  });

  it("台詞の飾り（鉤括弧・三点リーダ）を剥いでから見る", () => {
    expect(
      checkNoRepeatedBlockLead(
        wrap([
          "<dialogue>「……っ、やめ」</dialogue>",
          "<dialogue>「……っ、まって」</dialogue>",
          "<dialogue>「……っ、そこは」</dialogue>",
          "<dialogue>「……っ、だめ」</dialogue>",
        ]),
      ),
    ).toBe(false);
  });

  // <inner> は 1 応答に 1 個だけの設計なので、同じ書き出しの繰り返しは起こらん。
  it("<inner> だけでは落とさん", () => {
    expect(
      checkNoRepeatedBlockLead(
        `<response>${["a", "b", "c", "d"]
          .map((x) => `<inner>おなじ書き出し${x}</inner>`)
          .join("")}<dialogue>「ん」</dialogue></response>`,
      ),
    ).toBe(true);
  });

  it("XML やない本文は判定の対象外", () => {
    expect(checkNoRepeatedBlockLead("ただの平文")).toBe(true);
  });
});
