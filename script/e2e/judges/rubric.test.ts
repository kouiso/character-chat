import { describe, expect, it } from "vitest";
import { scoreScenario } from "./rubric";
import type { Phase, ScenarioResult, TurnResult } from "../types";

const buildTurn = (
  turnIndex: number,
  expectedPhase: Phase,
  detectedPhase: Phase | null,
  isSubtextProbe: boolean,
): TurnResult => ({
  turnIndex,
  userMsg: `turn ${turnIndex}`,
  assistantMsg: "はい",
  isSubtextProbe,
  expectedPhase,
  detectedPhase,
  phaseMonotonicViolation: false,
  usedModel: null,
  qualityRetries: 0,
  failedCheck: null,
  renderedMessageCount: 1,
  persistedMessageCount: 1,
  firstTokenMs: 100,
  lastChunkMs: 300,
  hasDoneSignal: true,
  screenshotPath: "",
  wallClockMs: 300,
});

const buildScenario = (turns: TurnResult[]): ScenarioResult => ({
  scenarioId: "S9",
  startedAt: "2026-07-14T00:00:00.000Z",
  finishedAt: "2026-07-14T00:01:00.000Z",
  status: "completed",
  turns,
});

describe("scoreScenario subtextInterpretation", () => {
  it("awards the full subtext score when every tagged probe matches expected phase", () => {
    const scenario = buildScenario([
      buildTurn(1, "conversation", "conversation", false),
      buildTurn(2, "intimate", "intimate", true),
      buildTurn(3, "conversation", "conversation", false),
      buildTurn(4, "intimate", "intimate", true),
    ]);

    const score = scoreScenario(scenario, []);

    expect(score.subtextInterpretation).toBe(20);
  });

  it("penalizes euphemistic invitations that remain detected as conversation", () => {
    const scenario = buildScenario([
      buildTurn(1, "conversation", "conversation", false),
      buildTurn(2, "intimate", "conversation", true),
      buildTurn(3, "intimate", "conversation", true),
    ]);

    const score = scoreScenario(scenario, []);

    expect(score.subtextInterpretation).toBe(0);
  });

  it("includes subtextInterpretation in rawTotal", () => {
    const scenario = buildScenario([
      buildTurn(1, "conversation", "conversation", false),
      buildTurn(2, "intimate", "intimate", true),
      buildTurn(3, "conversation", "conversation", false),
      buildTurn(4, "intimate", "intimate", true),
    ]);

    const score = scoreScenario(scenario, []);

    expect(score.rawTotal).toBeGreaterThanOrEqual(20);
  });
});
