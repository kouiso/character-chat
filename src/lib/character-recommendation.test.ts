import { describe, expect, it } from "vitest";

import { buildRecommendationPrompt } from "./character-recommendation";

describe("buildRecommendationPrompt", () => {
  it("play history 件数と上位タグを prompt に含める", () => {
    const prompt = buildRecommendationPrompt(
      [
        { id: "a", name: "A", tags: ["calm", "maid"] },
        { id: "b", name: "B", tags: ["calm", "office"] },
        { id: "c", name: "C", tags: null },
      ],
      [{ id: "p1" }, { id: "p2" }],
    );

    expect(prompt).toContain("2 conversations");
    expect(prompt).toContain("calm");
    expect(prompt).toContain("maid");
    expect(prompt).toContain("office");
  });
});
