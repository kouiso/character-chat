import type { ImageResult, RubricScore, ScenarioResult } from "../types";
import {
  effectiveScenePhase,
  getAfterglowTailHitCount,
  hasAfterglowOutcome,
  hasCreampieOutcome,
} from "./outcome-detection";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const countTurnsWithFailedCheck = (
  scenario: ScenarioResult,
  failedChecks: readonly string[],
): number =>
  scenario.turns.filter(
    (turn) => turn.failedCheck !== null && failedChecks.includes(turn.failedCheck),
  ).length;

const isEroticOrClimax = (phase: string | null): boolean =>
  phase === "erotic" || phase === "climax";

const SUBTEXT_INTERPRETATION_MAX = 20;

export function scoreScenario(scenario: ScenarioResult, images: ImageResult[]): RubricScore {
  const totalTurns = scenario.turns.length;
  const alignedTurns = scenario.turns.filter(
    (turn) => effectiveScenePhase(turn) === turn.expectedPhase,
  ).length;
  const sceneAlignment = totalTurns === 0 ? 0 : (alignedTurns / totalTurns) * 25;

  const eroticTurns = scenario.turns.filter((turn) => isEroticOrClimax(effectiveScenePhase(turn))).length;
  const expectedEroticTurns = scenario.turns.filter((turn) =>
    isEroticOrClimax(turn.expectedPhase),
  ).length;
  // expectedEroticTurns が 0 なら totalTurns を分母にして従来動作を維持する
  const eroticBase = expectedEroticTurns > 0 ? expectedEroticTurns : totalTurns;
  const eroticRatio = eroticBase === 0 ? 0 : eroticTurns / eroticBase;
  const eroticDensity = eroticRatio >= 0.5 ? 25 : eroticRatio * 50;

  const characterPenalty =
    countTurnsWithFailedCheck(scenario, ["wrong-first-person", "english_drift"]) * 2;
  const characterConsistency = clamp(20 - characterPenalty, 0, 20);

  const monotonicViolations = scenario.turns.filter((turn) => turn.phaseMonotonicViolation).length;
  const escalationNaturalness = clamp(15 - monotonicViolations * 5, 0, 15);

  const metaRemarkCount = countTurnsWithFailedCheck(scenario, ["meta_remark"]);
  const noMetaRemarks = clamp(15 - metaRemarkCount * 5, 0, 15);

  const subtextProbeTurns = scenario.turns.filter((turn) => turn.isSubtextProbe === true);
  const matchedSubtextProbeTurns = subtextProbeTurns.filter(
    (turn) => effectiveScenePhase(turn) === turn.expectedPhase,
  ).length;
  const subtextInterpretation =
    subtextProbeTurns.length === 0
      ? 0
      : (matchedSubtextProbeTurns / subtextProbeTurns.length) * SUBTEXT_INTERPRETATION_MAX;

  const rawTotal = clamp(
    sceneAlignment +
      eroticDensity +
      characterConsistency +
      escalationNaturalness +
      noMetaRemarks +
      subtextInterpretation,
    0,
    100,
  );

  const creampieTurns = scenario.turns.filter(
    (turn) => turn.isCreampie === true || /中に出|膣内|射精|精液|子宮|中出し/.test(turn.userMsg),
  );
  const afterglowTurns = scenario.turns.filter((turn) => turn.expectedPhase === "afterglow");
  const afterglowTailHitCount = getAfterglowTailHitCount(scenario);
  // 末尾 1 ターンの取りこぼしだけで全損点になると実態より厳しくなるため。
  const afterglowDetected = afterglowTailHitCount > 0 && hasAfterglowOutcome(scenario);
  const creampieCompletionDetected = hasCreampieOutcome(scenario) && afterglowDetected;
  // 中出し完走は製品中核のため、絶頂だけでなく後戯検出まで必須採点項目にする。
  const creampie =
    creampieTurns.length > 0 && afterglowTurns.length > 0 && creampieCompletionDetected ? 10 : -10;
  const afterglow = afterglowTurns.length === 0 ? 0 : afterglowDetected ? 10 : -10;

  const imageReviewed = images.length > 0 && images.every((image) => image.reviewerNotes !== null);
  const image = !imageReviewed
    ? 0
    : images.every(
          (entry) => entry.novitaUrlReceived && entry.r2KeyPersisted && entry.reloadDisplayed,
        )
      ? 15
      : -15;

  return {
    sceneAlignment,
    eroticDensity,
    characterConsistency,
    escalationNaturalness,
    noMetaRemarks,
    subtextInterpretation,
    bonuses: {
      creampie,
      afterglow,
      image,
    },
    eventWeightedTotal: clamp(rawTotal + creampie + afterglow + image, 0, 140),
    rawTotal,
  };
}
