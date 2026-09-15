import { describe, expect, it } from "vitest";

import { mergeContinuationResponse, wrapProseAsResponseBlocks } from "../lib/route-context";

// 実測 2026-08-20 phase58: 抜き所の 6 ターン中 5 ターンが、続き書きでフロアを超えた本文
// （可視 1051〜1150）を持っとったのに body-wall で落として、代わりに 402〜616 字の
// 短い試行を配っとった。壁はモデルが作ったんやのうて、合流の側が作っとった。
//
// 続き書きへは「終了タグを一切出力しない」と指示しとるのでタグ無しで返ってくる。
// その時 mergeBlocksInOrder がブロック 0 個で空振りして、種類ごとに束ねる側へ落ちる。
const base =
  "<response><action>玄関で鍵をかける。</action><dialogue>「……来ちゃった」</dialogue>" +
  "<action>指先が震える。</action><dialogue>「怖い、です」</dialogue></response>";

const countBlocks = (text: string, tag: string): number =>
  [...text.matchAll(new RegExp(`<${tag}>`, "g"))].length;

describe("タグ無しで返ってきた続き書きの合流", () => {
  it("base が持っとった交互構成を潰さん", () => {
    const merged = mergeContinuationResponse(base, "彼女の背が壁につく。息が上がる。", true);

    expect(countBlocks(merged, "action")).toBeGreaterThanOrEqual(3);
    expect(countBlocks(merged, "dialogue")).toBeGreaterThanOrEqual(2);
  });

  it("地の文を <dialogue> の中へ入れん（台詞として読まれてまう）", () => {
    const merged = mergeContinuationResponse(base, "彼女の背が壁につく。息が上がる。", true);

    expect(merged).toContain("<action>彼女の背が壁につく。息が上がる。</action>");
    expect(merged).not.toMatch(/<dialogue>[^<]*彼女の背が壁につく/);
  });

  it("続きに台詞が混じっとったら台詞として分ける", () => {
    const blocks = wrapProseAsResponseBlocks("背が壁につく。「あ……」手が伸びる。");

    expect(blocks).toContain("<dialogue>「あ……」</dialogue>");
    expect(blocks).toContain("<action>背が壁につく。</action>");
    expect(blocks).toContain("<action>手が伸びる。</action>");
  });

  it("タグ付きで返ってきた時は今までどおり", () => {
    const merged = mergeContinuationResponse(
      base,
      "<action>背が壁につく。</action><dialogue>「あ……」</dialogue>",
      true,
    );

    expect(countBlocks(merged, "action")).toBe(3);
    expect(countBlocks(merged, "dialogue")).toBe(3);
  });
});
