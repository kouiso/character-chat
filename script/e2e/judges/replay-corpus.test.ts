import { describe, expect, it } from "vitest";
import {
  diffLabels,
  formatSummaryTable,
  replayCorpus,
  summarize,
  type CorpusTurn,
  type PhaseJudge,
} from "./replay-corpus";
import type { Phase } from "../types";

// 実コーパス(.work/e2e-results)は増減するのでテスト対象にしない。集計ロジックだけを
// 固定の偽コーパスで検証する。
const turn = (
  overrides: Partial<CorpusTurn> & Pick<CorpusTurn, "expectedPhase">,
): CorpusTurn => ({
  runId: "run-1",
  scenarioId: "S1",
  turnIndex: 1,
  recordedPhase: null,
  assistantMsg: "本文",
  ...overrides,
});

/** assistantMsg をそのままラベルとして返す judge。 */
const literalJudge: PhaseJudge = ({ assistantMsg }) => ({ detected: assistantMsg as Phase });

describe("replayCorpus", () => {
  it("chains previousDetected within a scenario and resets across scenarios", () => {
    const turns: CorpusTurn[] = [
      turn({ scenarioId: "S1", turnIndex: 1, expectedPhase: "conversation" }),
      turn({ scenarioId: "S1", turnIndex: 2, expectedPhase: "intimate" }),
      turn({ scenarioId: "S2", turnIndex: 1, expectedPhase: "erotic" }),
    ];
    const seen: (Phase | null)[] = [];
    const recording: PhaseJudge = ({ previousDetected }) => {
      seen.push(previousDetected);
      return { detected: "erotic" };
    };
    replayCorpus(turns, recording);
    expect(seen).toEqual([null, "erotic", null]);
  });

  it("resets the chain when the run changes even if scenarioId repeats", () => {
    const turns: CorpusTurn[] = [
      turn({ runId: "run-1", scenarioId: "S1", expectedPhase: "conversation" }),
      turn({ runId: "run-2", scenarioId: "S1", expectedPhase: "conversation" }),
    ];
    const seen: (Phase | null)[] = [];
    replayCorpus(turns, ({ previousDetected }) => {
      seen.push(previousDetected);
      return { detected: "climax" };
    });
    expect(seen).toEqual([null, null]);
  });

  // scenario-runner.ts の RECENT_PHASE_WINDOW_TURNS(7) と揃える回帰テスト。
  it("caps recentDetected at the live path's 7-turn window", () => {
    const turns: CorpusTurn[] = Array.from({ length: 9 }, (_, i) =>
      turn({ turnIndex: i + 1, expectedPhase: "erotic" }),
    );
    const windowSizes: number[] = [];
    replayCorpus(turns, ({ recentDetected }) => {
      windowSizes.push(recentDetected?.length ?? 0);
      return { detected: "erotic" };
    });
    expect(windowSizes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7]);
  });
});

describe("summarize", () => {
  const turns: CorpusTurn[] = [
    turn({ expectedPhase: "conversation", assistantMsg: "conversation" }),
    turn({ expectedPhase: "intimate", assistantMsg: "erotic" }),
    turn({ expectedPhase: "erotic", assistantMsg: "erotic" }),
    turn({ expectedPhase: "climax", assistantMsg: "erotic" }),
  ];

  it("counts expected, judged and agreed per phase", () => {
    const summary = summarize(turns, replayCorpus(turns, literalJudge));
    expect(summary.total).toBe(4);
    expect(summary.agreed).toBe(2);
    expect(summary.agreementRate).toBe(0.5);
    const byPhase = Object.fromEntries(summary.rows.map((r) => [r.phase, r]));
    expect(byPhase.erotic).toMatchObject({ expected: 1, judged: 3, agreed: 1 });
    expect(byPhase.conversation).toMatchObject({ expected: 1, judged: 1, agreed: 1 });
    expect(byPhase.intimate).toMatchObject({ expected: 1, judged: 0, agreed: 0 });
    expect(byPhase.afterglow).toMatchObject({ expected: 0, judged: 0, agreed: 0 });
  });

  it("lists every phase even when the corpus is empty", () => {
    const summary = summarize([], []);
    expect(summary.total).toBe(0);
    expect(summary.agreementRate).toBe(0);
    expect(summary.rows).toHaveLength(5);
    expect(formatSummaryTable(summary)).toContain("afterglow");
  });
});

describe("diffLabels", () => {
  const turns: CorpusTurn[] = [
    turn({ turnIndex: 1, expectedPhase: "erotic" }), // wrong → right
    turn({ turnIndex: 2, expectedPhase: "intimate" }), // right → wrong
    turn({ turnIndex: 3, expectedPhase: "climax" }), // wrong → wrong (still changed)
    turn({ turnIndex: 4, expectedPhase: "conversation" }), // unchanged
  ];
  const baseline: Phase[] = ["intimate", "intimate", "intimate", "conversation"];
  const head: Phase[] = ["erotic", "erotic", "erotic", "conversation"];

  it("splits changed turns into improvement, regression and neutral", () => {
    const diff = diffLabels(turns, baseline, head);
    expect(diff.total).toBe(4);
    expect(diff.changed).toHaveLength(3);
    expect(diff.improved).toBe(1);
    expect(diff.regressed).toBe(1);
    expect(diff.neutral).toBe(1);
    expect(diff.changed.map((c) => `${c.from}→${c.to}`)).toEqual([
      "intimate→erotic",
      "intimate→erotic",
      "intimate→erotic",
    ]);
    expect(diff.changed.map((c) => c.direction)).toEqual(["improved", "regressed", "neutral"]);
  });

  it("reports agreement rates for both versions", () => {
    const diff = diffLabels(turns, baseline, head);
    expect(diff.baselineAgreementRate).toBe(0.5);
    expect(diff.headAgreementRate).toBe(0.5);
  });

  it("returns no changes when both versions agree", () => {
    const diff = diffLabels(turns, head, head);
    expect(diff.changed).toHaveLength(0);
    expect(diff.improved + diff.regressed + diff.neutral).toBe(0);
  });
});
