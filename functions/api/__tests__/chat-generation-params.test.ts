import { describe, expect, it } from "vitest";

import { valuesDiffer } from "../lib/route-context";

describe("ChatGenerationParams extras", () => {
  it("valuesDiffer は temperature/max_tokens だけでなく penalty/stop も比較する", () => {
    const base = { temperature: 0.7, max_tokens: 3224 };
    const withPenalty = {
      temperature: 0.7,
      max_tokens: 3224,
      frequency_penalty: 0.2,
      presence_penalty: 0.2,
      stop: ["\n\n\n\n"],
    };

    expect(valuesDiffer(base, withPenalty)).toBe(true);
  });

  it("valuesDiffer は stop 配列の内容違いを検出する", () => {
    const a = { temperature: 0.7, max_tokens: 3224, stop: ["\n\n\n"] };
    const b = { temperature: 0.7, max_tokens: 3224, stop: ["\n\n\n\n"] };

    expect(valuesDiffer(a, b)).toBe(true);
  });
});
