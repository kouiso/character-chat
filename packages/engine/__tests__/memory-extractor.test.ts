import { FakeListChatModel } from "@langchain/core/utils/testing";

import { extractMemories } from "../src/memory-extractor";

const memory = {
  kind: "preference",
  content: "紅茶が好き",
  importance: 3,
  validFrom: null,
  validUntil: null,
};
const modelFor = (memories: unknown[]) =>
  new FakeListChatModel({ responses: [JSON.stringify({ memories })] });

describe("extractMemories", () => {
  it("元の発言から引用した記憶だけを返し、重複を除く", async () => {
    await expect(
      extractMemories(modelFor([memory, memory]), "私は紅茶が好きです。"),
    ).resolves.toEqual([memory]);
    await expect(extractMemories(modelFor([]), "こんにちは")).resolves.toEqual([]);
  });

  it("作り話・不正な期間・件数超過・JSON以外を拒否する", async () => {
    await expect(extractMemories(modelFor([memory]), "私はコーヒーが好きです。")).rejects.toThrow();
    await expect(
      extractMemories(modelFor([{ ...memory, validFrom: "2026-01-01" }]), "紅茶が好き"),
    ).rejects.toThrow();
    await expect(
      extractMemories(modelFor(Array.from({ length: 9 }, () => memory)), "紅茶が好き"),
    ).rejects.toThrow();
    await expect(
      extractMemories(new FakeListChatModel({ responses: ["not JSON"] }), "紅茶が好き"),
    ).rejects.toThrow("応答形式");
  });
});
