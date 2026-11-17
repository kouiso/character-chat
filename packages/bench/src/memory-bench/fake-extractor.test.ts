import { describe, expect, it } from "vitest";
import { extractMemories } from "@v2/engine";

import { createFakeExtractor } from "./fake-extractor";

describe("fake extractor", () => {
  it("表の行から kind/content/subject をそのまま返す", async () => {
    const extractor = createFakeExtractor([
      {
        text: "私の好きな飲み物は紅茶だよ",
        memories: [{ kind: "fact", content: "私の好きな飲み物は紅茶だよ", subject: "drink" }],
      },
    ]);
    const memories = await extractMemories(extractor, "私の好きな飲み物は紅茶だよ");
    expect(memories).toEqual([
      expect.objectContaining({
        kind: "fact",
        content: "私の好きな飲み物は紅茶だよ",
        subject: "drink",
      }),
    ]);
  });

  it("表に無い問いかけは空、それ以外は本文を記憶にする", async () => {
    const extractor = createFakeExtractor([]);
    await expect(extractMemories(extractor, "私の名前、覚えてる？")).resolves.toEqual([]);
    await expect(extractMemories(extractor, "明日は雨らしいね")).resolves.toEqual([
      expect.objectContaining({ kind: "fact", content: "明日は雨らしいね", subject: "" }),
    ]);
  });
});
