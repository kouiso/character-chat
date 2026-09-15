// @vitest-environment node
import { describe, expect, it } from "vitest";

import { splitResponseBlocks, truncateOverlongFallback } from "../lib/route-context";

// 上限超過の切り詰めが走るのは長文エロ、つまりいちばん地の文の壁が出やすい条件。
// 節ごとに組み直すと、モデルが交互に書いた並びが「地の文まとめ→台詞まとめ」の 2 段へ
// 潰れて、撮り直しを使い切った最後の配信でちょうど壁が復活する（敵対レビュー 2026-08-19）。

const order = (text: string): string =>
  splitResponseBlocks(text)
    .map((b) => b.tag)
    .join(">");

const alternating = `<response>${["あ", "う", "お"]
  .map((c) => `<action>${c.repeat(60)}</action><dialogue>「${"い".repeat(40)}」</dialogue>`)
  .join("")}<inner>心の声</inner></response>`;

describe("上限で切り詰めても並びは保つ", () => {
  it("交互の並びが 2 段へ潰れん", () => {
    expect(order(alternating)).toBe("action>dialogue>action>dialogue>action>dialogue>inner");

    const truncated = truncateOverlongFallback(alternating, 200);

    expect(order(truncated)).toContain("action>dialogue>action");
  });

  // ブロックごとに比率で削ると短い台詞が閉じ括弧ごと切れる（実測 phase42: 6 個中 5 個）。
  it("残ったブロックの鉤括弧が閉じたままになる", () => {
    const truncated = truncateOverlongFallback(alternating, 200);

    for (const block of splitResponseBlocks(truncated)) {
      if (block.tag !== "dialogue") continue;
      const open = [...block.content].filter((c) => c === "「").length;
      const close = [...block.content].filter((c) => c === "」").length;
      expect(close).toBe(open);
    }
  });

  it("上限に収まっとるなら手を付けん", () => {
    expect(truncateOverlongFallback(alternating, 100_000)).toBe(alternating);
  });
});
