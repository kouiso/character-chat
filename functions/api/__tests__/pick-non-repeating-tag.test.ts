import { describe, expect, it } from "vitest";

import { pickNonRepeatingTag } from "../lib/route-context";

// pickNonRepeatingTag はモジュールスコープの可変状態を持たず、
// 同一シードなら同一結果、異なる nonce なら多様なタグを返す。

describe("pickNonRepeatingTag", () => {
  it("空配列の場合は空文字を返す", () => {
    expect(pickNonRepeatingTag("key", [], "nonce")).toBe("");
  });

  it("要素が 1 つの場合はその要素を返す", () => {
    expect(pickNonRepeatingTag("key", ["only"], "nonce")).toBe("only");
  });

  it("同一 key/tags/nonce なら同じ結果を返す", () => {
    const tags = ["a", "b", "c", "d"];
    const first = pickNonRepeatingTag("same", tags, "nonce");
    const second = pickNonRepeatingTag("same", tags, "nonce");
    expect(first).toBe(second);
  });

  it("nonce が異なると多くのケースで異なるタグを返す", () => {
    const tags = ["a", "b", "c", "d", "e"];
    const first = pickNonRepeatingTag("key", tags, "one");
    const second = pickNonRepeatingTag("key", tags, "two");
    expect(first).not.toBe(second);
  });

  it("cacheKey が異なると同一 nonce でも異なる結果を返しうる", () => {
    const tags = ["a", "b", "c"];
    const first = pickNonRepeatingTag("key1", tags, "x");
    const second = pickNonRepeatingTag("key2", tags, "x");
    expect(first).toBeTypeOf("string");
    expect(second).toBeTypeOf("string");
    expect(tags).toContain(first);
    expect(tags).toContain(second);
  });

  it("複数回呼んでも返り値は常に tags のいずれかである", () => {
    const tags = ["x", "y", "z"];
    for (let i = 0; i < 20; i += 1) {
      const picked = pickNonRepeatingTag("loop", tags, `n${i}`);
      expect(tags).toContain(picked);
    }
  });
});
