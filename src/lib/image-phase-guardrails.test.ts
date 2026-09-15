import { describe, expect, it } from "vitest";

import {
  PHASE_GUARDRAILS,
  sanitizeImageTagsForPhase,
  stripActiveClimaxTags,
  stripClimaxTags,
  stripConflictingLocationTags,
  stripJpClimaxKeywords,
} from "../../functions/api/lib/image-phase-guardrails";

describe("PHASE_GUARDRAILS", () => {
  it("conversation phase blocks all sexual content as the safest default", () => {
    expect(PHASE_GUARDRAILS.conversation.negativeExtra).toContain("cum");
    expect(PHASE_GUARDRAILS.conversation.negativeExtra).toContain("sex");
    expect(PHASE_GUARDRAILS.conversation.negativeExtra).toContain("nudity");
    expect(PHASE_GUARDRAILS.conversation.allowClimaxTags).toBe(false);
  });

  it("intimate phase blocks climax but allows undressing context", () => {
    expect(PHASE_GUARDRAILS.intimate.negativeExtra).toContain("creampie");
    expect(PHASE_GUARDRAILS.intimate.negativeExtra).toContain("ejaculation");
    expect(PHASE_GUARDRAILS.intimate.negativeExtra).toContain("cum");
    expect(PHASE_GUARDRAILS.intimate.negativeExtra).toContain("penetration");
    expect(PHASE_GUARDRAILS.intimate.allowClimaxTags).toBe(false);
  });

  it("erotic phase allows sex/penetration but blocks ejaculation (mid-act)", () => {
    expect(PHASE_GUARDRAILS.erotic.negativeExtra).toContain("cum");
    expect(PHASE_GUARDRAILS.erotic.negativeExtra).toContain("creampie");
    expect(PHASE_GUARDRAILS.erotic.negativeExtra).toContain("ejaculation");
    expect(PHASE_GUARDRAILS.erotic.negativeExtra).not.toContain("penetration");
    expect(PHASE_GUARDRAILS.erotic.negativeExtra).not.toContain("sex,");
    expect(PHASE_GUARDRAILS.erotic.allowClimaxTags).toBe(false);
  });

  it("climax phase allows climax tags but blocks hand-count anatomy defects", () => {
    expect(PHASE_GUARDRAILS.climax.allowClimaxTags).toBe(true);
    expect(PHASE_GUARDRAILS.climax.negativeExtra).toContain("three_hands");
    expect(PHASE_GUARDRAILS.climax.negativeExtra).toContain("extra_arms");
    expect(PHASE_GUARDRAILS.climax.negativeExtra).not.toContain("creampie");
  });

  it("afterglow phase blocks active sex but allows post-coital aftermath", () => {
    expect(PHASE_GUARDRAILS.afterglow.negativeExtra).toContain("penetration");
    expect(PHASE_GUARDRAILS.afterglow.negativeExtra).toContain("thrusting");
    expect(PHASE_GUARDRAILS.afterglow.negativeExtra).not.toContain("sexual");
    expect(PHASE_GUARDRAILS.afterglow.allowClimaxTags).toBe(true);
  });
});

describe("stripClimaxTags", () => {
  it("removes cum / creampie / ejaculation tokens at the word level", () => {
    const input = "1girl, sex, vaginal, cum, creampie, sweat, pussy_juice";
    const out = stripClimaxTags(input);
    expect(out).not.toMatch(/\bcum\b/);
    expect(out).not.toContain("creampie");
    expect(out).toContain("sweat");
    expect(out).toContain("pussy_juice");
    expect(out).toContain("sex");
  });

  it("preserves cum_drip and post-coital aftermath tags", () => {
    const input = "lying_together, cum_drip, cum_on_thighs, peaceful";
    const out = stripClimaxTags(input);
    expect(out).toContain("cum_drip");
    expect(out).toContain("cum_on_thighs");
    expect(out).toContain("peaceful");
  });

  it("handles weighted tags like (cum:1.3)", () => {
    const input = "sex, (cum:1.3), thrusting";
    const out = stripClimaxTags(input);
    expect(out).not.toMatch(/cum[^_]/);
    expect(out).toContain("thrusting");
  });

  it("removes ejaculation variants", () => {
    const input = "1girl, ejaculating, semen, bukkake";
    const out = stripClimaxTags(input);
    expect(out).not.toContain("ejaculating");
    expect(out).not.toContain("semen");
    expect(out).not.toContain("bukkake");
    expect(out).toContain("1girl");
  });

  it("returns empty-ish string when all tags are climax-only", () => {
    expect(stripClimaxTags("cum, creampie, ejaculation").trim()).toBe("");
  });
});

describe("stripActiveClimaxTags (afterglow post-strip)", () => {
  it("afterglow でも cum_in_pussy / cum_inside / cumshot などの『進行中』タグは弾く", () => {
    const input = "lying_together, cum_in_pussy, cum_inside, cumshot, sweat, peaceful";
    const out = stripActiveClimaxTags(input);
    expect(out).not.toContain("cum_in_pussy");
    expect(out).not.toContain("cum_inside");
    expect(out).not.toContain("cumshot");
    expect(out).toContain("lying_together");
    expect(out).toContain("sweat");
    expect(out).toContain("peaceful");
  });

  it("afterglow で cum_drip / cum_on_thighs などの事後流体タグは残す", () => {
    const input = "lying_together, cum_drip, cum_on_thighs, cum_pool, messy, wet";
    const out = stripActiveClimaxTags(input);
    expect(out).toContain("cum_drip");
    expect(out).toContain("cum_on_thighs");
    expect(out).toContain("cum_pool");
    expect(out).toContain("messy");
    expect(out).toContain("wet");
  });

  it("ejaculation / ejaculating / bukkake / orgasm も afterglow では弾く", () => {
    const input = "1girl, ejaculation, ejaculating, bukkake, orgasm";
    const out = stripActiveClimaxTags(input);
    expect(out).not.toContain("ejaculation");
    expect(out).not.toContain("ejaculating");
    expect(out).not.toContain("bukkake");
    expect(out).not.toContain("orgasm");
    expect(out).toContain("1girl");
  });
});

describe("stripJpClimaxKeywords", () => {
  it("removes 射精 and 中出し from Japanese prompt", () => {
    const input = "彼女を抱きしめながら射精する。中出しした。";
    const out = stripJpClimaxKeywords(input);
    expect(out).not.toContain("射精");
    expect(out).not.toContain("中出し");
    expect(out).toContain("抱きしめ");
  });

  it("removes 精液 and ぶっかけ and ザーメン", () => {
    const input = "精液まみれ、ぶっかけ、ザーメン";
    const out = stripJpClimaxKeywords(input);
    expect(out).not.toContain("精液");
    expect(out).not.toContain("ぶっかけ");
    expect(out).not.toContain("ザーメン");
  });

  it("leaves non-climax Japanese intact", () => {
    const input = "優しくキスをして抱きしめる";
    expect(stripJpClimaxKeywords(input)).toBe(input);
  });
});

describe("sanitizeImageTagsForPhase", () => {
  it("conversation removes nudity / partial undress tags", () => {
    const input =
      "1girl, off-shoulder white knit cardigan, bare shoulders and decolletage, fully clothed, outdoors";
    const out = sanitizeImageTagsForPhase("conversation", input);
    expect(out).not.toContain("off-shoulder");
    expect(out).not.toContain("bare shoulders");
    expect(out).not.toContain("decolletage");
    expect(out).toContain("fully clothed");
    expect(out).toContain("outdoors");
  });

  it("conversation keeps safe clothing tags", () => {
    const input = "1girl, school uniform, shirt, skirt, smiling, classroom";
    expect(sanitizeImageTagsForPhase("conversation", input)).toContain("school uniform");
    expect(sanitizeImageTagsForPhase("conversation", input)).toContain("shirt");
    expect(sanitizeImageTagsForPhase("conversation", input)).toContain("skirt");
  });

  it("intimate does not strip partial undress", () => {
    const input = "1girl, lingerie, bare shoulders, off shoulder, blush";
    const out = sanitizeImageTagsForPhase("intimate", input);
    expect(out).toContain("lingerie");
    expect(out).toContain("bare shoulders");
    expect(out).toContain("off shoulder");
  });
});

describe("stripConflictingLocationTags", () => {
  it("removes generic bedroom/bed tags when background constraint is sofa", () => {
    const imageTags = "1girl, nude, on_bed, bedroom, indoors, sex, missionary";
    const keep = "indoor, living_room, on_sofa";
    const out = stripConflictingLocationTags(imageTags, keep);
    expect(out).not.toContain("on_bed");
    expect(out).not.toContain("bedroom");
    expect(out).not.toContain("indoors");
    expect(out).toContain("nude");
    expect(out).toContain("sex");
    expect(out).toContain("missionary");
  });

  it("preserves tags that are part of the keep list", () => {
    const imageTags = "1girl, on_sofa, sofa, nude";
    const keep = "indoor, living_room, on_sofa";
    const out = stripConflictingLocationTags(imageTags, keep);
    const parts = out.split(", ");
    expect(parts).toContain("on_sofa");
    expect(parts).toContain("nude");
    expect(parts).not.toContain("sofa");
  });

  it("does not strip location tags when keepTags is empty", () => {
    const imageTags = "1girl, bedroom, on_bed, nude";
    const out = stripConflictingLocationTags(imageTags, "");
    expect(out).toContain("bedroom");
    expect(out).toContain("on_bed");
  });
});
