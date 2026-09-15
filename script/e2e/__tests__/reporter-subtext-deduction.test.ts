// @vitest-environment node
import { describe, expect, it } from "vitest";

import { scoreScenario } from "../judges/rubric";
import { scoreEntriesForScenario } from "../reporter";

// subtextInterpretation は rawTotal には混ぜていない（既存5指標で既に100点満点のため、
// 足すと clamp(...,0,100) に飲まれて他指標の劣化を隠す）。ただし reporter は減点として
// 出力しており、probe を持たないシナリオの 0 を「20点全部落とした」と表示していた。
// s1-s8 は probe を持たないので、幻の -20 が減点1位に居座って本物を top3 から押し出す。
const turn = (over: Record<string, unknown> = {}) => ({
  userMsg: "こんにちは",
  expectedPhase: "conversation",
  detectedPhase: "conversation",
  failedCheck: null,
  phaseMonotonicViolation: false,
  ...over,
});

const scenarioOf = (turns: unknown[]) =>
  ({ scenarioId: "s-test", turns }) as unknown as Parameters<typeof scoreEntriesForScenario>[0];

const subtextDeduction = (turns: unknown[]) => {
  const scenario = scenarioOf(turns);
  const score = scoreScenario(scenario as never, []);
  const entries = scoreEntriesForScenario(scenario, score);
  const entry = entries.find((e) => e.label === "subtextInterpretation");
  expect(entry).toBeDefined();
  return entry;
};

describe("reporter: subtextInterpretation の減点表示", () => {
  it("probe を持たないシナリオでは減点0・理由は n/a（幻の -20 を出さない）", () => {
    const entry = subtextDeduction([turn(), turn()]);
    expect(entry?.deduction).toBe(0);
    expect(entry?.reason).toContain("n/a");
  });

  it("probe を持ち全部外したシナリオでは満点分を減点する", () => {
    const entry = subtextDeduction([
      turn({ isSubtextProbe: true, expectedPhase: "intimate", detectedPhase: "conversation" }),
    ]);
    expect(entry?.deduction).toBe(20);
  });

  it("probe を持ち全部当てたシナリオでは減点0", () => {
    const entry = subtextDeduction([
      turn({ isSubtextProbe: true, expectedPhase: "intimate", detectedPhase: "intimate" }),
    ]);
    expect(entry?.deduction).toBe(0);
  });
});
