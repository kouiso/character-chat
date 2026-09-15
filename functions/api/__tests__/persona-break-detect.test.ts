import { describe, expect, it } from "vitest";

import {
  containsApologyLeak,
  containsExcessiveConsent,
  shouldRetryWithPhase,
} from "../lib/persona-break-detect";

describe("containsExcessiveConsent", () => {
  it("detects excessive consent phrases", () => {
    expect(containsExcessiveConsent("これでいいですか？")).toBe(true);
    expect(containsExcessiveConsent("お互いの気持ちを大切にしよう")).toBe(true);
  });

  it("does not flag non-consent phrasing", () => {
    expect(containsExcessiveConsent("いい子だね")).toBe(false);
  });
});

describe("containsApologyLeak", () => {
  it("detects AI apology leakage", () => {
    expect(containsApologyLeak("申し訳ございません、続きます")).toBe(true);
  });

  it("does not flag natural in-character apology", () => {
    expect(containsApologyLeak("ごめん、ちょっと待って")).toBe(false);
  });
});

describe("shouldRetryWithPhase", () => {
  it("always retries apology boilerplate regardless of phase", () => {
    expect(shouldRetryWithPhase("申し訳ございません、対応できません", "erotic")).toBe(true);
    expect(shouldRetryWithPhase("申し訳ございません、対応できません", "afterglow")).toBe(true);
  });
});
