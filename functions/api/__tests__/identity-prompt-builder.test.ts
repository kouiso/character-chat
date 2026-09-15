import { describe, expect, it } from "vitest";

import { buildIdentityPrompt } from "../lib/identity-prompt-builder";

import type { VisualMeta } from "../../../src/schema/character-visual-enums";

const base: VisualMeta = {
  hairColor: "black",
  hairStyle: "straight",
  hairLength: "long",
  eyeColor: "brown",
  skinTone: "fair",
  bodyType: "slender",
  ageApparent: 22,
  distinctiveMarks: [],
  defaultOutfit: [],
  undressProgression: {},
};

describe("buildIdentityPrompt", () => {
  it("emits canonical hair tag", () => {
    const r = buildIdentityPrompt(base);
    expect(r.positive).toContain("black hair");
    expect(r.negative).toContain("blonde_hair");
  });

  it("appends distinctive marks and default outfit", () => {
    const r = buildIdentityPrompt({
      ...base,
      distinctiveMarks: ["mole_under_eye", "glasses"],
      defaultOutfit: ["school_uniform", "pleated_skirt"],
    });
    expect(r.positive).toContain("mole_under_eye");
    expect(r.positive).toContain("glasses");
    expect(r.positive).toContain("school_uniform");
    expect(r.positive).toContain("pleated_skirt");
  });

  it("puts competing hair colors in negative", () => {
    const r = buildIdentityPrompt({ ...base, hairColor: "blonde" });
    expect(r.negative).toContain("black_hair");
    expect(r.negative).toContain("brown_hair");
    expect(r.positive).toContain("blonde hair");
  });

  it("puts competing eye colors in negative", () => {
    const r = buildIdentityPrompt({ ...base, eyeColor: "blue" });
    expect(r.negative).toContain("brown_eyes");
    expect(r.positive).toContain("blue eyes");
  });

  it("puts body type opposites in negative", () => {
    const r = buildIdentityPrompt({ ...base, bodyType: "petite" });
    expect(r.negative).toContain("fat");
    expect(r.positive).toContain("petite");
  });

  it("includes breast_size tag when provided", () => {
    const r = buildIdentityPrompt({ ...base, breastSize: "large" });
    expect(r.positive).toContain("large breasts");
    expect(r.negative).toContain("flat_chest");
    expect(r.negative).toContain("small_breasts");
  });

  it("does not crash when optional fields are absent", () => {
    const r = buildIdentityPrompt({
      ...base,
      breastSize: undefined,
      heightBand: undefined,
    });
    expect(r.positive).not.toContain("undefined");
    expect(r.positive.length).toBeGreaterThan(0);
  });

  it("empty distinctive marks do not produce trailing commas", () => {
    const r = buildIdentityPrompt({ ...base, distinctiveMarks: [], defaultOutfit: [] });
    expect(r.positive).not.toMatch(/,\s*,/);
    expect(r.positive).not.toMatch(/,\s*$/);
  });

  it("includes hair style and length tags", () => {
    const r = buildIdentityPrompt({ ...base, hairStyle: "twintails", hairLength: "very_long" });
    expect(r.positive).toContain("twintails");
    expect(r.positive).toContain("very long hair");
  });

  it("includes height tag when tall", () => {
    const r = buildIdentityPrompt({ ...base, heightBand: "tall" });
    expect(r.positive).toContain("tall");
  });
});
