import { describe, expect, it } from "vitest";

import {
  buildVisualAnchorPrompt,
  dedupePromptTags,
  NOVITA_HAIR_COLOR_NEGATIVE_TAGS,
  stripFloatingCumTags,
  VISUAL_ANCHOR_WEIGHT,
} from "../lib/image-prompt-anchors";

describe("buildVisualAnchorPrompt", () => {
  it("uses the configured visual anchor weight for detected hair color", () => {
    expect(buildVisualAnchorPrompt("brown hair, blue eyes, slender", VISUAL_ANCHOR_WEIGHT)).toBe(
      "(brown hair:1.6), (blue eyes, slender:1.6)",
    );
  });

  it("falls back to uniform weight when no hair color anchor exists", () => {
    expect(buildVisualAnchorPrompt("blue eyes, slender", 1.9)).toBe("(blue eyes, slender:1.9)");
  });

  it("does not wrap skin tone tags in weight brackets (white-fly prevention)", () => {
    // pale skin:1.9 は肌を白飛びさせる。素タグとして末尾に追加されるべき。
    expect(buildVisualAnchorPrompt("blonde hair, blue eyes, pale skin", 1.9)).toBe(
      "(blonde hair:1.9), (blue eyes:1.9), pale skin",
    );
  });

  it("handles skin tone tag without hair color", () => {
    expect(buildVisualAnchorPrompt("blue eyes, fair skin", 1.9)).toBe("(blue eyes:1.9), fair skin");
  });

  it("handles skin tone tag only", () => {
    expect(buildVisualAnchorPrompt("pale skin", 1.9)).toBe("pale skin");
  });

  it("keeps multiple skin tone tags bare while weighting other anchors", () => {
    expect(buildVisualAnchorPrompt("black hair, olive skin", 1.6)).toBe(
      "(black hair:1.6), olive skin",
    );
  });
});

describe("dedupePromptTags", () => {
  it("collapses weighted and bare duplicates of the same tag to the first occurrence", () => {
    // climax で実際に起きていた二重積み: (cum:1.3) と cum、(creampie:1.3) と creampie、ahegao×2
    const input =
      "1girl, (ahegao:1.3), (cum:1.3), (creampie:1.3), semen, ahegao, cum, creampie, cum_drip";
    expect(dedupePromptTags(input)).toBe(
      "1girl, (ahegao:1.3), (cum:1.3), (creampie:1.3), semen, cum_drip",
    );
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(dedupePromptTags("Blush,  blush , BLUSH, smile")).toBe("Blush, smile");
  });

  it("leaves distinct tags (cum vs cum_drip vs cum_on_thighs) untouched", () => {
    const input = "cum, cum_drip, cum_on_thighs, creampie";
    expect(dedupePromptTags(input)).toBe(input);
  });

  it("drops empty segments from trailing/duplicate commas", () => {
    expect(dedupePromptTags("a, , b,, a")).toBe("a, b");
  });
});

describe("stripFloatingCumTags", () => {
  it("removes floating/facial cum tags but keeps located creampie tags", () => {
    // 翻訳 LLM が吐く汎用 cum/ejaculation/cum_inside は除去、中出し局所タグは残す
    const input =
      "1girl, (creampie:1.3), cum_in_pussy, cum_dripping_from_pussy, cum, semen, ejaculation, cum_inside, facial, bukkake, cum_on_thighs";
    expect(stripFloatingCumTags(input)).toBe(
      "1girl, (creampie:1.3), cum_in_pussy, cum_dripping_from_pussy, cum_on_thighs",
    );
  });

  it("is case-insensitive and weight-aware (strips (cum:1.3))", () => {
    expect(stripFloatingCumTags("smile, (Cum:1.3), CUMSHOT, blush")).toBe("smile, blush");
  });

  it("strips cum_drip but keeps cum_dripping_from_pussy", () => {
    const input = "1girl, cum_drip, cum_dripping_from_pussy, creampie";
    expect(stripFloatingCumTags(input)).toBe("1girl, cum_dripping_from_pussy, creampie");
  });

  it("leaves a prompt with no floating cum untouched", () => {
    const input = "1girl, blush, creampie, cum_in_pussy";
    expect(stripFloatingCumTags(input)).toBe(input);
  });
});

describe("NOVITA_HAIR_COLOR_NEGATIVE_TAGS", () => {
  it("includes pink/magenta/dyed/rainbow hair suppressors", () => {
    expect(NOVITA_HAIR_COLOR_NEGATIVE_TAGS).toContain("pink_hair");
    expect(NOVITA_HAIR_COLOR_NEGATIVE_TAGS).toContain("magenta_hair");
    expect(NOVITA_HAIR_COLOR_NEGATIVE_TAGS).toContain("dyed_hair");
    expect(NOVITA_HAIR_COLOR_NEGATIVE_TAGS).toContain("rainbow_hair");
  });
});
