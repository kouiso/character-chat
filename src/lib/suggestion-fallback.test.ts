import { describe, expect, it } from "vitest";

import { getFallbackSuggestions } from "./suggestion-fallback";

describe("getFallbackSuggestions", () => {
  it("phase 未指定時は conversation の候補を返す", () => {
    expect(getFallbackSuggestions(undefined)).toEqual(getFallbackSuggestions("conversation"));
  });

  it("phase ごとの候補を返す", () => {
    expect(getFallbackSuggestions("climax")).toEqual([
      "限界の直前に、名前を呼ばせる。",
      "今だけは強がらず、全部言葉にしてもらう。",
      "一番崩れた表情を覚えておくと伝える。",
    ]);
  });
});
