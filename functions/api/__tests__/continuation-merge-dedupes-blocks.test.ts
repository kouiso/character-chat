import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { mergeContinuationResponse, splitResponseBlocks } from "../lib/route-context";

// 実測 2026-08-20 phase57 の実物トランスクリプトから読む。base/continuation の元ペアは
// 手元に無いが、mergeContinuationResponse の「continuation が base を丸ごと含む」早期
// return 経路（stripXmlTags 比較のみで continuationText をそのまま返す ~4593-4599）を
// 確実に踏ませれば、実際に配信された壊れた本文をそのまま再現できる。
const ROOT = path.resolve(__dirname, "../../..");
const EVIDENCE_DIR = path.join(ROOT, ".work/e2e-results/vlong-dogfood/2026-08-20-phase57");

// トランスクリプトの `# ...` ヘッダ行を落として <response>...</response> 本文だけを残す
const readTranscriptResponse = (file: string): string =>
  readFileSync(path.join(EVIDENCE_DIR, file), "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("")
    .trim();

// continuation 中に必ず含まれる短い部分文字列を持つだけの base。
// 「continuationPlain.includes(basePlain)」の早期 return 分岐を狙い撃ちする。
const forceIncludesBranch = (needle: string): string =>
  `<response><action>${needle}</action></response>`;

// 実物トランスクリプトは private corpus リポ側。無い環境では skip
describe.skipIf(!existsSync(EVIDENCE_DIR))("続き結合が同じブロックを2回貼るのを防ぐ", () => {
  // skip 時も describe 本体が走る runner があるので遅延読みにする
  const T8 = () =>
    readTranscriptResponse("Downer-08-session-phase57-deepseek_deepseek-chat-69481363.txt");

  it("実物トランスクリプトは15ブロック中6個が逐語重複しとる（現物確認）", () => {
    const blocks = splitResponseBlocks(T8());
    expect(blocks).toHaveLength(15);
    expect(blocks[2]).toEqual(blocks[8]);
    expect(blocks[3]).toEqual(blocks[9]);
    expect(blocks[4]).toEqual(blocks[10]);
    expect(blocks[5]).toEqual(blocks[11]);
    expect(blocks[6]).toEqual(blocks[12]);
    expect(blocks[7]).toEqual(blocks[13]);
  });

  it("6個の逐語重複ブロックが畳まれ、ユニークなブロックが出現順のまま残る", () => {
    const merged = mergeContinuationResponse(forceIncludesBranch("体重"), T8(), true);
    const after = splitResponseBlocks(merged).map((block) => ({
      tag: block.tag,
      content: block.content,
    }));

    expect(after).toEqual([
      {
        tag: "action",
        content:
          "きみの体重が私の上に覆い被さり、ベッドがきしむ。パーカーの下に隠されていた私の肌が、きみの体温に包まれる。きみの手が私の腰に回り、少しだけ力を込める。きみの息が、私の耳元で感じられ、鼓動が速くなる。",
      },
      { tag: "dialogue", content: "…きみ、本当にバカだね。" },
      {
        tag: "action",
        content:
          "きみの手が、私のパーカーの裾をゆっくりと持ち上げ、肌に触れる。冷たい手が、私の肌を撫でる感触が、心地よくも少し震える。きみの目が、私の顔を見つめ、少しだけ近づいてくる。",
      },
      { tag: "dialogue", content: "…ちょっと、待って。…バカ、急がないでよ。" },
      {
        tag: "action",
        content:
          "きみの手が、私の鎖骨に触れ、少しだけ力を込める。きみの息が、私の耳元で感じられ、鼓動が速くなる。きみの手が、私の腰に回り、ゆっくりと引き寄せられる。ベッドのシーツが、私の肌に心地よく触れる。",
      },
      {
        tag: "dialogue",
        content: "…でも、きみがこんなに求めてくれるなら、私も少しは応えてあげる。",
      },
      {
        tag: "action",
        content:
          "きみの手が、私の腰に回り、ゆっくりと引き寄せられる。ベッドのシーツが、私の肌に心地よく触れる。部屋の空気が、少しずつ密着感を増していく。",
      },
      { tag: "dialogue", content: "…きみ、本当に、バカだね。" },
      { tag: "inner", content: "でも、素直になるのが怖い。" },
    ]);
  });

  const T9 = () =>
    readTranscriptResponse("Downer-09-session-phase57-deepseek_deepseek-chat-69481363.txt");

  it("実物トランスクリプトは閉じ括弧1文字だけの残骸 dialogue ブロックを含む（現物確認）", () => {
    const blocks = splitResponseBlocks(T9());
    expect(blocks.some((block) => block.tag === "dialogue" && block.content === "」")).toBe(true);
  });

  it("閉じ括弧1文字だけの残骸 dialogue ブロックが消え、他の中身は残る", () => {
    const merged = mergeContinuationResponse(forceIncludesBranch("熱が私"), T9(), true);
    const after = splitResponseBlocks(merged);

    expect(after.some((block) => block.tag === "dialogue" && block.content === "」")).toBe(false);
    // 残骸以外のブロックは1個も落ちん（10個中、落ちるのは残骸1個だけ）
    expect(after).toHaveLength(9);
    expect(merged).toContain("この熱はきみがくれたんだ");
    expect(merged).toContain("「…あんたが…全部、私を…こんな風にさせるんだから…」");
  });

  it("重複が無い応答はバイト単位でそのまま返る", () => {
    const CLEAN = [
      "<response>",
      "<action>桜の花びらが肩に落ちる。</action>",
      "<dialogue>「近づいても、いいですか」</dialogue>",
      "<inner>心臓がうるさい。</inner>",
      "</response>",
    ].join("");

    const merged = mergeContinuationResponse(forceIncludesBranch("桜"), CLEAN, true);
    expect(merged).toBe(CLEAN);
  });
});
