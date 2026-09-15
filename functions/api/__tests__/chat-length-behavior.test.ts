import { describe, expect, it } from "vitest";

import { resolvePhaseAwareResponseLength } from "../[[route]]";
import { isTooShortCloseEnough } from "../lib/route-context";

// フロアは resolveResponseFloor に一本化した。erotic/climax の 600 字固定は
// short と medium を同じ値へ潰しとったので、段ごとに違う値になっとることを見る
// （段の相互関係そのものは response-length-band.test.ts が総当たりで固定する）。
describe("resolvePhaseAwareResponseLength", () => {
  it("medium erotic applies erotic longform hint and phase floor", () => {
    const result = resolvePhaseAwareResponseLength("erotic", "medium");

    expect(result.isLongResponse).toBe(true);
    expect(result.eroticLongformHint).toContain("官能長文指示");
    expect(result.intimateLongformHint).toBe("");
    expect(result.longResponseMinChars).toBe(820);
    expect(resolvePhaseAwareResponseLength("erotic", "short").longResponseMinChars).toBe(574);
  });

  it("medium climax applies climax longform hint and shared phase floor", () => {
    const result = resolvePhaseAwareResponseLength("climax", "medium");

    expect(result.isLongResponse).toBe(true);
    expect(result.eroticLongformHint).toContain("絶頂長文指示");
    expect(result.intimateLongformHint).toBe("");
    expect(result.longResponseMinChars).toBe(900);
    expect(resolvePhaseAwareResponseLength("climax", "short").longResponseMinChars).toBe(630);
  });

  it("相手のターンが長いとフロアが上がる（設定は据え置き）", () => {
    const quiet = resolvePhaseAwareResponseLength("erotic", "medium", 5);
    const written = resolvePhaseAwareResponseLength("erotic", "medium", 200);

    expect(written.longResponseMinChars).toBeGreaterThan(quiet.longResponseMinChars ?? 0);
  });

  it.each(["conversation", "intimate"] as const)("medium %s stays on the short path", (phase) => {
    const result = resolvePhaseAwareResponseLength(phase, "medium");

    expect(result.isLongResponse).toBe(false);
    expect(result.eroticLongformHint).toBe("");
    expect(result.intimateLongformHint).toBe("");
    expect(result.longResponseMinChars).toBeUndefined();
  });

  it("keeps intimate longform hint separate from erotic/climax hints", () => {
    const result = resolvePhaseAwareResponseLength("intimate", "long");

    expect(result.isLongResponse).toBe(true);
    expect(result.eroticLongformHint).toBe("");
    expect(result.intimateLongformHint).toContain("情交前長文指示");
    expect(result.longResponseMinChars).toBe(585);
  });

  it("longform hints do not contain length caps (delegated to lengthDirective) (#633)", () => {
    const erotic = resolvePhaseAwareResponseLength("erotic", "medium");
    const climax = resolvePhaseAwareResponseLength("climax", "medium");
    const intimate = resolvePhaseAwareResponseLength("intimate", "long");

    expect(erotic.eroticLongformHint).not.toContain("1100字");
    expect(climax.eroticLongformHint).not.toContain("1100字");
    expect(intimate.intimateLongformHint).not.toContain("1100字");
  });
});

// 敵対レビュー #1236 指摘・7巡目: isDegreeOnlyQualityFailure に isVeryLongResponse を
// 通してkeepRelayedAttempt経路は塞いだが、too_short撮り直しループ内の別出口
// isTooShortCloseEnough は longResponseMinChars(1300) の85%（1105字）以上なら
// 撮り直さず素通りさせていた。very_long指定時はこの近似出口自体を塞ぐ。
describe("isTooShortCloseEnough", () => {
  const context = (overrides: { longResponseMinChars?: number } = {}) => ({
    phase: "erotic" as const,
    longResponseMinChars: 1300,
    ...overrides,
  });

  it("very_long指定時は1300字の85%(1105字)でも近似出口を通さない", () => {
    const text = "あ".repeat(1200);
    expect(isTooShortCloseEnough(text, context(), true)).toBe(false);
  });

  it("very_long指定でなければ従来どおり85%閾値で通る", () => {
    const text = "あ".repeat(1200);
    expect(isTooShortCloseEnough(text, context(), false)).toBe(true);
  });

  it("isVeryLongResponse未指定（デフォルトfalse）でも従来どおり85%閾値で通る", () => {
    const text = "あ".repeat(1200);
    expect(isTooShortCloseEnough(text, context())).toBe(true);
  });
});
