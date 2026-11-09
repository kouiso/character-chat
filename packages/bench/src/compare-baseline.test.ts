import { describe, expect, it } from "vitest";

import { compareBaseline } from "./compare-baseline";

const baseline = {
  recordedAt: "2026-11-09",
  recall: { retrieval: 0.5, cheat: 1, none: 0 },
  adversarial: { checks: "4/4", sabotageCaught: "4/4" },
};
const recall = (retrieval: number, cheat = 1, none = 0) => ({
  retrieval: { checks: { 50: true, 200: retrieval > 0.5 }, ratio: retrieval },
  cheat: { checks: { 50: true, 200: true }, ratio: cheat },
  none: { checks: { 50: false, 200: false }, ratio: none },
});
const adversarial = (checks = "4/4", sabotageCaught = "4/4") => ({
  totals: { checks, sabotageCaught },
  ok: checks === "4/4" && sabotageCaught === "4/4",
});

describe("compareBaseline（RIT-98）", () => {
  it("基準値と同じ結果なら ok", () => {
    const report = compareBaseline(baseline, recall(0.5), adversarial());
    expect(report.ok).toBe(true);
    expect(report.regressions).toEqual([]);
  });

  it("記憶を切った版（retrieval が 0）で赤になる", () => {
    const report = compareBaseline(baseline, recall(0), adversarial());
    expect(report.ok).toBe(false);
    expect(report.regressions).toEqual(["recall:retrieval 0.5 → 0"]);
  });

  it("良くなった分は下回り扱いにせん", () => {
    const report = compareBaseline(baseline, recall(1), adversarial());
    expect(report.ok).toBe(true);
  });

  it("いじわる試験の件数が欠けると赤になる", () => {
    const report = compareBaseline(baseline, recall(0.5), adversarial("3/4"));
    expect(report.ok).toBe(false);
    expect(report.regressions).toContain("adversarial:checks 4/4 → 3/4");
  });
});
