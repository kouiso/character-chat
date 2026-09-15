import { describe, expect, it } from "vitest";

import { mergeContinuationResponse, splitResponseBlocks } from "../lib/route-context";

const BASE = [
  "<response>",
  "<action>桜の花びらが肩に落ちる。指先が制服の袖を握る。</action>",
  "<dialogue>「あの…近づいても、いいですか」</dialogue>",
  "<action>視線が揺れて、頬が赤らむ。</action>",
  "<dialogue>「わたし、こんなの知らなくて」</dialogue>",
  "<inner>心臓がうるさい。</inner>",
  "</response>",
].join("");

const CONTINUATION = [
  "<response>",
  "<action>膝が震えて、体重があなたへ傾く。</action>",
  "<dialogue>「もう、立っていられません」</dialogue>",
  "<inner>止まってほしくない。</inner>",
  "</response>",
].join("");

describe("続きを足しても地の文と台詞の並びを崩さん", () => {
  it("交互の並びが 1 タグ 1 塊へ潰れん", () => {
    const merged = mergeContinuationResponse(BASE, CONTINUATION, true);
    const tags = splitResponseBlocks(merged).map((block) => block.tag);

    // 潰れると ["action","dialogue","inner"] の 3 個になる。
    expect(tags.filter((tag) => tag === "action").length).toBeGreaterThan(1);
    expect(tags.filter((tag) => tag === "dialogue").length).toBeGreaterThan(1);
  });

  it("<inner> は非表示で 1 つだけという約束を守る", () => {
    const merged = mergeContinuationResponse(BASE, CONTINUATION, true);
    expect(splitResponseBlocks(merged).filter((block) => block.tag === "inner")).toHaveLength(1);
  });

  it("続きの本文が落ちん", () => {
    const merged = mergeContinuationResponse(BASE, CONTINUATION, true);
    expect(merged).toContain("膝が震えて");
    expect(merged).toContain("もう、立っていられません");
  });

  it("前の本文も落ちん", () => {
    const merged = mergeContinuationResponse(BASE, CONTINUATION, true);
    expect(merged).toContain("桜の花びらが肩に落ちる");
    expect(merged).toContain("わたし、こんなの知らなくて");
  });

  it("続きが前回をそっくり含んどる時は続きをそのまま使う（従来どおり）", () => {
    const full = BASE.replace("</response>", "<action>さらに一歩。</action></response>");
    expect(mergeContinuationResponse(BASE, full, true)).toBe(full);
  });
});
