import { describe, expect, it } from "vitest";

import {
  collectRecordsFromManifests,
  parseGateCliArgs,
  renderGateReport,
  renderPhaseTimeline,
} from "./gate-899";
import { evaluateGates } from "./gate-metrics";

import type { RunManifest, TurnResult } from "./types";

const turn = (turnIndex: number, phase: TurnResult["detectedPhase"]): TurnResult =>
  ({
    turnIndex,
    userMsg: "続けて",
    assistantMsg: `ターン${turnIndex}の描写がここに入る文章である。`,
    expectedPhase: phase ?? "erotic",
    detectedPhase: phase,
    phaseMonotonicViolation: false,
    usedModel: "deepseek/deepseek-chat-v3-0324",
    qualityRetries: 0,
    failedCheck: null,
    renderedMessageCount: 1,
    persistedMessageCount: 1,
    firstTokenMs: 1_000 + turnIndex,
    lastChunkMs: 9_000 + turnIndex,
    hasDoneSignal: true,
    screenshotPath: "shot.png",
    wallClockMs: 9_100 + turnIndex,
  }) as TurnResult;

const manifest = (runId: string, scenarioIds: string[]): RunManifest =>
  ({
    runId,
    startedAt: "2026-07-25T00:00:00.000Z",
    finishedAt: null,
    status: "completed",
    scenarios: scenarioIds.map((scenarioId) => ({
      scenarioId,
      status: "completed",
      turns: [turn(1, "erotic"), turn(2, "climax"), turn(3, "afterglow")],
      rubricScore: {
        sceneAlignment: 25,
        eroticDensity: 25,
        characterConsistency: 20,
        escalationNaturalness: 15,
        noMetaRemarks: 15,
        subtextInterpretation: 0,
        bonuses: { creampie: 10, afterglow: 10, image: 0 },
        eventWeightedTotal: 95,
        rawTotal: 100,
      },
    })),
    rubricScore: null,
    artifactsDir: `.work/e2e-results/runs/${runId}`,
    cdpPort: 9222,
  }) as unknown as RunManifest;

describe("parseGateCliArgs", () => {
  it("既定では実走モードになる", () => {
    const options = parseGateCliArgs([]);
    expect(options.fromRuns).toBeNull();
    expect(options.resultsRoot).toBe(".work/e2e-results");
  });

  it("--from-runs で再集計モードに切り替える", () => {
    const options = parseGateCliArgs(["--from-runs=a,b,c"]);
    expect(options.fromRuns).toEqual(["a", "b", "c"]);
  });

  it("空の --from-runs を拒否する", () => {
    expect(() => parseGateCliArgs(["--from-runs="])).toThrow(/1 件以上/u);
  });

  it("重複した runId を拒否する", () => {
    expect(() => parseGateCliArgs(["--from-runs=a,b,a"])).toThrow(/重複した runId/u);
  });

  it("未知の引数を拒否する", () => {
    expect(() => parseGateCliArgs(["--nope"])).toThrow(/未知の引数/u);
  });

  it("pnpm run が渡す区切りの -- を無視する", () => {
    const options = parseGateCliArgs(["--", "--from-runs=a,b"]);
    expect(options.fromRuns).toEqual(["a", "b"]);
  });
});

describe("collectRecordsFromManifests", () => {
  it("対象シナリオだけを run 単位で集める", () => {
    const records = collectRecordsFromManifests([
      { runIndex: 1, manifest: manifest("r1", ["S4", "S5", "S6", "S7", "S8"]) },
      { runIndex: 2, manifest: manifest("r2", ["S4", "S6", "S7", "S8"]) },
    ]);

    expect(records).toHaveLength(8);
    expect(records.every((record) => record.scenarioId !== "S5")).toBe(true);
    expect(records.filter((record) => record.runIndex === 2)).toHaveLength(4);
  });

  it("3 run 揃えば実行回数ゲートを通す", () => {
    const records = collectRecordsFromManifests(
      [1, 2, 3].map((runIndex) => ({
        runIndex,
        manifest: manifest(`r${runIndex}`, ["S4", "S6", "S7", "S8"]),
      })),
    );
    const runGate = evaluateGates(records).find((verdict) => verdict.gate.includes("各3回"));
    expect(records).toHaveLength(12);
    expect(runGate?.pass).toBe(true);
  });
});

describe("renderGateReport", () => {
  it("ゲートごとに PASS/FAIL と分母を出す", () => {
    const records = collectRecordsFromManifests([
      { runIndex: 1, manifest: manifest("r1", ["S4"]) },
    ]);
    const report = renderGateReport(evaluateGates(records));
    expect(report).toContain("| gate |");
    expect(report).toContain("FAIL");
    expect(report).toContain("TTFB p95 < 10000ms");
  });
});

describe("renderPhaseTimeline", () => {
  it("turn ごとの expected/detected を残す", () => {
    const records = collectRecordsFromManifests([
      { runIndex: 1, manifest: manifest("r1", ["S4"]) },
    ]);
    const timeline = renderPhaseTimeline(records);
    expect(timeline).toContain("S4 run1 (r1)");
    expect(timeline).toContain("expected=climax detected=climax");
  });
});
