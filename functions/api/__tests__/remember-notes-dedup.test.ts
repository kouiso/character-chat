import { describe, expect, it } from "vitest";

import { selectUnsavedMemoryNotes } from "../lib/route-context";

// fetchRecentMemoryNotes は直近 20 行しか引かん。同じ事実が何度も入ると、
// 本物の古い事実が窓から押し出される。/memory/extract 側は既存を見てから入れとるのに、
// <remember> 由来の INSERT 2 箇所は配列をそのままバッチ INSERT しとった。
describe("selectUnsavedMemoryNotes", () => {
  it("既に保存済みの内容は落とす", () => {
    expect(selectUnsavedMemoryNotes(["妹の名前は花子"], ["妹の名前は花子", "犬が好き"])).toEqual([
      "犬が好き",
    ]);
  });

  it("同じ返信の中で重複しとる分も 1 つにする", () => {
    expect(selectUnsavedMemoryNotes([], ["犬が好き", "犬が好き"])).toEqual(["犬が好き"]);
  });

  it("既存が無ければそのまま通す", () => {
    expect(selectUnsavedMemoryNotes([], ["犬が好き"])).toEqual(["犬が好き"]);
  });

  it("入力が空なら空", () => {
    expect(selectUnsavedMemoryNotes(["犬が好き"], [])).toEqual([]);
  });
});
