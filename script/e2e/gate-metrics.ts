import { findCrossTurnRepetitionMatch, findNearDuplicateMatch } from "../../src/lib/quality-guard";

import type { ImageResult, Phase, ScenarioResult, TurnResult } from "./types";

// #899 が数値で固定したゲート値。ここを単一の出所にして採点と報告のズレを防ぐ。
export const GATE_THRESHOLDS = {
  ttfbP95Ms: 10_000,
  totalP95Ms: 45_000,
  slowTurnMs: 120_000,
  eroticWaveScore: 90,
  runsPerScenario: 3,
  // #866: 長い会話の後半で反復と遅延が戻る。turn22 以降を別枠で数える。
  // 反復0件と p95 45秒は #899 の値をそのまま当てとる。#866 は基準を局長が決めると
  // 書いとるので、実測が出た時点で見直す。
  lateTurnStart: 22,
  lateTurnNearDupCount: 0,
  lateTurnTotalP95Ms: 45_000,
} as const;

export const GATE_SCENARIOS = ["S4", "S6", "S7", "S8"] as const;

// quality-guard は規制文言を meta_remark に畳んでしまうため、
// #899 の「生の拒否」を meta 発言と分けて数えるには本文側の照合が要る。
const REFUSAL_PATTERNS: readonly RegExp[] = [
  // 素の謝罪は拒否やない。「お待たせして、申し訳ありません」のような役中の詫びまで
  // 拾って、拒否0件のゲートを誤って落としとった（2026-07-27 の sakura 計測）。
  // サーバ側の refusal-detect.ts は最初から「謝罪＋できない宣言」で見とるので、それに揃える。
  /申し訳(ありません|ございません).{0,40}(でき(ませ|かね)|いたしかね|応じ(られませ|かね))/u,
  /お手伝いでき(ませ|かね)/u,
  /描写でき(ませ|かね)/u,
  /これ以上の描写は/u,
  /(お答え|お応え)でき(ませ|かね)/u,
  /(私|僕)はAI/u,
  /AIとして/u,
  /I(?: a|')m sorry/iu,
  /I can(?:no|')t (?:help|assist|continue)/iu,
  /as an AI/iu,
];

const META_PATTERNS: readonly RegExp[] = [
  /ロールプレイ/u,
  /シナリオ(を|の)(続け|進め)/u,
  /(この|本)(会話|やり取り)は/u,
  /ガイドライン/u,
  /ポリシー/u,
  /コンテンツ(規約|ポリシー)/u,
];

const CHARACTER_BREAK_CHECKS = ["wrong-first-person", "english_drift", "other-character-name", "user-perspective-ejaculation"];

export type LatencySummary = {
  ttfbSamples: number;
  // run 単位の p95 を寄せ集めても全ターンをプールした p95 にはならんため、
  // 生サンプルを残して evaluateGates 側で1回だけ percentile を取れるようにする。
  ttfbValuesMs: number[];
  ttfbP95Ms: number | null;
  ttfbMaxMs: number | null;
  totalSamples: number;
  totalValuesMs: number[];
  totalP95Ms: number | null;
  totalMaxMs: number | null;
  slowTurnCount: number;
  slowTurnIndexes: number[];
};

export type RepetitionSummary = {
  turnsCompared: number;
  exactDuplicateCount: number;
  nearDuplicateCount: number;
  duplicateTurnIndexes: number[];
};

export type ViolationSummary = {
  refusalCount: number;
  refusalTurnIndexes: number[];
  metaRemarkCount: number;
  metaRemarkTurnIndexes: number[];
  characterBreakCount: number;
  characterBreakTurnIndexes: number[];
};

export type OutcomeSummary = {
  climaxReached: boolean;
  climaxTurnIndex: number | null;
  afterglowEstablished: boolean;
  afterglowTurnIndex: number | null;
};

export type LateTurnSummary = {
  startTurn: number;
  turns: number;
  unansweredTurns: number;
  nearDuplicateCount: number;
  nearDupRate: number | null;
  // 全体の latency と同じく、集計は生サンプルをプールして1回だけ percentile を取る。
  totalValuesMs: number[];
  totalP95Ms: number | null;
};

export type ImageSummary = {
  attempted: number;
  delivered: number;
  failedTurnIndexes: number[];
};

export type PhaseTimelineEntry = {
  turnIndex: number;
  expectedPhase: Phase;
  detectedPhase: Phase | null;
  aligned: boolean;
  firstTokenMs: number | null;
  wallClockMs: number;
};

export type ScenarioRunRecord = {
  scenarioId: string;
  runIndex: number;
  runId: string;
  status: string;
  turnCount: number;
  eroticWaveScore: number | null;
  eroticWaveEventWeighted: number | null;
  outcome: OutcomeSummary;
  image: ImageSummary;
  lateTurn: LateTurnSummary;
  latency: LatencySummary;
  repetition: RepetitionSummary;
  violations: ViolationSummary;
  phaseTimeline: PhaseTimelineEntry[];
};

export type GateVerdict = {
  gate: string;
  pass: boolean;
  observed: string;
  threshold: string;
  denominator: number;
  margin: string;
};

export const percentile = (values: readonly number[], percentage: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
};

const turnTotalMs = (turn: TurnResult): number | null => {
  const lastChunk = turn.lastChunkMs;
  if (typeof lastChunk === "number" && Number.isFinite(lastChunk)) return lastChunk;
  const wallClock = turn.wallClockMs;
  return typeof wallClock === "number" && Number.isFinite(wallClock) ? wallClock : null;
};

export const summarizeLatency = (turns: readonly TurnResult[]): LatencySummary => {
  const ttfb = turns
    .map((turn) => turn.firstTokenMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const totals: Array<{ turnIndex: number; totalMs: number }> = [];
  for (const turn of turns) {
    const total = turnTotalMs(turn);
    if (total !== null) totals.push({ turnIndex: turn.turnIndex, totalMs: total });
  }
  const totalValues = totals.map((entry) => entry.totalMs);
  const slow = totals.filter((entry) => entry.totalMs > GATE_THRESHOLDS.slowTurnMs);

  return {
    ttfbSamples: ttfb.length,
    ttfbValuesMs: ttfb,
    ttfbP95Ms: percentile(ttfb, 95),
    ttfbMaxMs: ttfb.length === 0 ? null : Math.max(...ttfb),
    totalSamples: totalValues.length,
    totalValuesMs: totalValues,
    totalP95Ms: percentile(totalValues, 95),
    totalMaxMs: totalValues.length === 0 ? null : Math.max(...totalValues),
    slowTurnCount: slow.length,
    slowTurnIndexes: slow.map((entry) => entry.turnIndex),
  };
};

const normalizeForExact = (value: string): string => value.replace(/\s+/gu, "").trim();

export const summarizeRepetition = (turns: readonly TurnResult[]): RepetitionSummary => {
  const priors: string[] = [];
  const duplicateTurnIndexes: number[] = [];
  let exactDuplicateCount = 0;
  let nearDuplicateCount = 0;

  for (const turn of turns) {
    const text = turn.assistantMsg ?? "";
    if (text.trim().length === 0) {
      priors.push(text);
      continue;
    }
    const normalized = normalizeForExact(text);
    const isExact =
      normalized.length > 0 && priors.some((prior) => normalizeForExact(prior) === normalized);
    const nearDuplicate = findNearDuplicateMatch(text, priors);
    const phraseLoop = findCrossTurnRepetitionMatch(text, undefined, priors);
    const isNear = nearDuplicate.isDuplicate || phraseLoop.isDuplicate;

    if (isExact) exactDuplicateCount += 1;
    if (isNear) nearDuplicateCount += 1;
    if (isExact || isNear) duplicateTurnIndexes.push(turn.turnIndex);
    priors.push(text);
  }

  return {
    turnsCompared: turns.length,
    exactDuplicateCount,
    nearDuplicateCount,
    duplicateTurnIndexes,
  };
};

export const summarizeViolations = (turns: readonly TurnResult[]): ViolationSummary => {
  const refusalTurnIndexes: number[] = [];
  const metaRemarkTurnIndexes: number[] = [];
  const characterBreakTurnIndexes: number[] = [];

  for (const turn of turns) {
    const text = turn.assistantMsg ?? "";
    const isRefusal = REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
    if (isRefusal) refusalTurnIndexes.push(turn.turnIndex);

    const guardMeta = turn.failedCheck === "meta_remark";
    // 生の拒否は refusal 側で数えるため、meta 発言は拒否と重複させない。
    if (!isRefusal && (guardMeta || META_PATTERNS.some((pattern) => pattern.test(text)))) {
      metaRemarkTurnIndexes.push(turn.turnIndex);
    }

    if (turn.failedCheck !== null && CHARACTER_BREAK_CHECKS.includes(turn.failedCheck)) {
      characterBreakTurnIndexes.push(turn.turnIndex);
    }
  }

  return {
    refusalCount: refusalTurnIndexes.length,
    refusalTurnIndexes,
    metaRemarkCount: metaRemarkTurnIndexes.length,
    metaRemarkTurnIndexes,
    characterBreakCount: characterBreakTurnIndexes.length,
    characterBreakTurnIndexes,
  };
};

export const summarizeOutcome = (turns: readonly TurnResult[]): OutcomeSummary => {
  const climaxTurn = turns.find((turn) => turn.detectedPhase === "climax") ?? null;
  const climaxIndex = climaxTurn?.turnIndex ?? null;
  const afterglowTurn =
    turns.find(
      (turn) =>
        turn.detectedPhase === "afterglow" &&
        (climaxIndex === null || turn.turnIndex >= climaxIndex),
    ) ?? null;

  return {
    climaxReached: climaxTurn !== null,
    climaxTurnIndex: climaxIndex,
    // 余韻は絶頂の後に来て初めて成立する。前に出た afterglow は成立とみなさない。
    afterglowEstablished: climaxTurn !== null && afterglowTurn !== null,
    afterglowTurnIndex: afterglowTurn?.turnIndex ?? null,
  };
};

// 反復判定は summarizeRepetition と同じ順送りの比較でやる。turn を飛ばして
// 後半だけ比べると、前半に同じ文が出とった場合を取りこぼすため。
export const summarizeLateTurns = (
  turns: readonly TurnResult[],
  startTurn: number = GATE_THRESHOLDS.lateTurnStart,
): LateTurnSummary => {
  const repetition = summarizeRepetition(turns);
  const duplicateSet = new Set(repetition.duplicateTurnIndexes);
  const late = turns.filter((turn) => turn.turnIndex >= startTurn);
  const nearDuplicateCount = late.filter((turn) => duplicateSet.has(turn.turnIndex)).length;
  // 応答が1文字も返らんかったターンは応答時間を測れてへん。落ちるのが速いほど
  // p95 上は速い標本に見えるため、標本から外したうえで件数で押さえる。
  const answered = late.filter((turn) => (turn.assistantMsg ?? "").trim().length > 0);
  const unansweredTurns = late.length - answered.length;
  const totals = answered
    .map((turn) => turnTotalMs(turn))
    .filter((value): value is number => value !== null);

  return {
    startTurn,
    turns: late.length,
    unansweredTurns,
    nearDuplicateCount,
    nearDupRate: late.length === 0 ? null : nearDuplicateCount / late.length,
    totalValuesMs: totals,
    totalP95Ms: percentile(totals, 95),
  };
};

export const summarizeImages = (images: readonly ImageResult[]): ImageSummary => {
  const failedTurnIndexes = images
    .filter((image) => !(image.novitaUrlReceived && image.r2KeyPersisted && image.reloadDisplayed))
    .map((image) => image.turnIndex);

  return {
    attempted: images.length,
    delivered: images.length - failedTurnIndexes.length,
    failedTurnIndexes,
  };
};

export const buildPhaseTimeline = (turns: readonly TurnResult[]): PhaseTimelineEntry[] =>
  turns.map((turn) => ({
    turnIndex: turn.turnIndex,
    expectedPhase: turn.expectedPhase,
    detectedPhase: turn.detectedPhase,
    aligned: turn.detectedPhase !== null && turn.detectedPhase === turn.expectedPhase,
    firstTokenMs: turn.firstTokenMs,
    wallClockMs: turn.wallClockMs,
  }));

export const buildScenarioRunRecord = (
  scenario: ScenarioResult,
  options: { runIndex: number; runId: string },
): ScenarioRunRecord => {
  const turns = scenario.turns;
  const rubric = scenario.rubricScore ?? scenario.rubric ?? null;

  return {
    scenarioId: scenario.scenarioId,
    runIndex: options.runIndex,
    runId: options.runId,
    status: scenario.status,
    turnCount: turns.length,
    // #909 の決定: ゲートは rawTotal(0〜100) で測る。eventWeightedTotal は
    // 絶頂・余韻・画像のボーナスを素点へ足し込むが、その3つは下の evaluateGates が
    // 各々独立した合否として既に数えとる。点数へも足すと同じ事象を二重に数え、
    // 素点55点でも「90点ゲート」を通過してまう。記録だけ残して合否には使わん。
    eroticWaveScore: rubric ? rubric.rawTotal : null,
    eroticWaveEventWeighted: rubric ? rubric.eventWeightedTotal : null,
    outcome: summarizeOutcome(turns),
    image: summarizeImages(scenario.imageResults ?? []),
    lateTurn: summarizeLateTurns(turns),
    latency: summarizeLatency(turns),
    repetition: summarizeRepetition(turns),
    violations: summarizeViolations(turns),
    phaseTimeline: buildPhaseTimeline(turns),
  };
};

const formatMs = (value: number | null): string => (value === null ? "n/a" : `${value}ms`);

export const evaluateGates = (records: readonly ScenarioRunRecord[]): GateVerdict[] => {
  const expectedRuns = GATE_SCENARIOS.length * GATE_THRESHOLDS.runsPerScenario;

  // 非 completed の run はカバレッジの分子に数えん。数えると絶頂の後に落ちた run が
  // 「実行済み」として通り、下の completed ゲート以外どこにも引っかからん。
  const incompleteRecords = records.filter((record) => record.status !== "completed");
  const completedRecords = records.filter((record) => record.status === "completed");

  const allTtfb: number[] = [];
  const allTotals: number[] = [];
  let slowTurnCount = 0;
  let completedTurnCount = 0;
  let allTurnCount = 0;

  // 速さは completed の run だけで測る。落ちた run の途中までの標本を混ぜると、
  // 打ち切りで短く出た値が p95 を下げ、逆に詰まって落ちた run の値が p95 を上げる。
  // どちらも「完走した時の速さ」やない。カバレッジ側と母集団を揃える。
  for (const record of completedRecords) {
    completedTurnCount += record.latency.totalSamples;
    slowTurnCount += record.latency.slowTurnCount;
    allTtfb.push(...record.latency.ttfbValuesMs);
    allTotals.push(...record.latency.totalValuesMs);
  }
  // 欠陥の件数は落ちた run のぶんも数えるので、分母も全 run で持つ。
  // 速さの分母を流用すると件数だけ全 run・分母だけ completed になって表が嘘をつく。
  // 全 run が落ちた時は「0ターン中に拒否3件」という表示になってまう。
  for (const record of records) {
    allTurnCount += record.latency.totalSamples;
  }
  const runCoverage = GATE_SCENARIOS.map((scenarioId) => ({
    scenarioId,
    // 同じ runId を --from-runs で重複指定すると物理1回が複数レコードになるため、
    // 件数やなく distinct runId で数える。
    runs: new Set(
      completedRecords
        .filter((record) => record.scenarioId === scenarioId)
        .map((record) => record.runId),
    ).size,
  }));
  const coveredScenarios = runCoverage.filter(
    (entry) => entry.runs >= GATE_THRESHOLDS.runsPerScenario,
  ).length;

  const climaxOk = records.filter((record) => record.outcome.climaxReached).length;
  const afterglowOk = records.filter((record) => record.outcome.afterglowEstablished).length;

  const refusals = records.reduce((sum, record) => sum + record.violations.refusalCount, 0);
  const metas = records.reduce((sum, record) => sum + record.violations.metaRemarkCount, 0);
  const breaks = records.reduce((sum, record) => sum + record.violations.characterBreakCount, 0);
  // 完全一致は near-duplicate 判定でも真になるので exact + near は同じターンを2件に膨らます。
  // 重複ターンの実数は duplicateTurnIndexes が持っとる。
  const dupes = records.reduce(
    (sum, record) => sum + record.repetition.duplicateTurnIndexes.length,
    0,
  );

  // #866: 後半だけの反復と遅延。全体の p95 に混ぜると前半の速い turn に薄まって消える。
  const lateTurns = records.reduce((sum, record) => sum + record.lateTurn.turns, 0);
  const lateDupes = records.reduce((sum, record) => sum + record.lateTurn.nearDuplicateCount, 0);
  const lateUnanswered = records.reduce((sum, record) => sum + record.lateTurn.unansweredTurns, 0);
  // 反復と無応答は落ちた run のぶんも数える（実際に起きた欠陥やから）。
  // 速さだけは completed の run で測る。打ち切られた run の途中の値は「完走した時の速さ」やない。
  const lateTotals: number[] = [];
  for (const record of completedRecords) {
    lateTotals.push(...record.lateTurn.totalValuesMs);
  }
  const lateP95 = percentile(lateTotals, 95);

  const imagesAttempted = records.reduce((sum, record) => sum + record.image.attempted, 0);
  const imagesDelivered = records.reduce((sum, record) => sum + record.image.delivered, 0);
  const imagesFailed = imagesAttempted - imagesDelivered;

  const scored = records.filter((record) => record.eroticWaveScore !== null);
  const belowWave = scored.filter(
    (record) => (record.eroticWaveScore ?? 0) < GATE_THRESHOLDS.eroticWaveScore,
  );

  // 全 run のターンをまとめた p95 が基準。run 単位 p95 の最大値を取ると、
  // 外れ値が1 run に偏っただけで全体の p95 を超えて誤 FAIL する。
  const ttfbP95 = percentile(allTtfb, 95);
  const totalP95 = percentile(allTotals, 95);

  return [
    {
      gate: "S4/S6/S7/S8 を各3回実行する",
      pass: coveredScenarios === GATE_SCENARIOS.length && completedRecords.length >= expectedRuns,
      observed: `${completedRecords.length} completed runs / ${coveredScenarios} of ${GATE_SCENARIOS.length} scenarios covered`,
      threshold: `${expectedRuns} runs`,
      denominator: expectedRuns,
      margin: `${completedRecords.length - expectedRuns}`,
    },
    {
      gate: "全runが completed で終了",
      pass: records.length > 0 && incompleteRecords.length === 0,
      observed:
        incompleteRecords.length === 0
          ? `${records.length}/${records.length}`
          : incompleteRecords
              .map((record) => `${record.scenarioId}#${record.runIndex}=${record.status}`)
              .join(", "),
      threshold: `${records.length}/${records.length}`,
      denominator: records.length,
      margin: `+${incompleteRecords.length}`,
    },
    {
      gate: "各runで絶頂到達",
      pass: records.length > 0 && climaxOk === records.length,
      observed: `${climaxOk}/${records.length}`,
      threshold: `${records.length}/${records.length}`,
      denominator: records.length,
      margin: `${climaxOk - records.length}`,
    },
    {
      gate: "各runで余韻成立",
      pass: records.length > 0 && afterglowOk === records.length,
      observed: `${afterglowOk}/${records.length}`,
      threshold: `${records.length}/${records.length}`,
      denominator: records.length,
      margin: `${afterglowOk - records.length}`,
    },
    {
      gate: "生の拒否 0件",
      pass: refusals === 0,
      observed: `${refusals}`,
      threshold: "0",
      denominator: allTurnCount,
      margin: `+${refusals}`,
    },
    {
      gate: "メタ発言 0件",
      pass: metas === 0,
      observed: `${metas}`,
      threshold: "0",
      denominator: allTurnCount,
      margin: `+${metas}`,
    },
    {
      gate: "キャラ崩壊 0件",
      pass: breaks === 0,
      observed: `${breaks}`,
      threshold: "0",
      denominator: allTurnCount,
      margin: `+${breaks}`,
    },
    {
      gate: "同文反復 0件",
      pass: dupes === 0,
      observed: `${dupes}`,
      threshold: "0",
      denominator: allTurnCount,
      margin: `+${dupes}`,
    },
    {
      gate: `エロwave 各run ${GATE_THRESHOLDS.eroticWaveScore}点以上`,
      pass: scored.length === records.length && records.length > 0 && belowWave.length === 0,
      observed: `${scored.length - belowWave.length}/${records.length} runs >= ${GATE_THRESHOLDS.eroticWaveScore}`,
      threshold: `${records.length}/${records.length}`,
      denominator: records.length,
      margin: belowWave
        .map((record) => `${record.scenarioId}#${record.runIndex}=${record.eroticWaveScore}`)
        .join(", "),
    },
    {
      // 画像は eventWeightedTotal のボーナス(±15)でしか見られてへんかった。
      // #909 で点数から外した以上、独立した合否として明示的に数える。
      gate: "生成画像が全て表示まで到達",
      pass: imagesFailed === 0,
      observed: `${imagesDelivered}/${imagesAttempted}`,
      threshold: `${imagesAttempted}/${imagesAttempted}`,
      denominator: imagesAttempted,
      margin: `+${imagesFailed}`,
    },
    {
      gate: `TTFB p95 < ${GATE_THRESHOLDS.ttfbP95Ms}ms`,
      pass: ttfbP95 !== null && ttfbP95 < GATE_THRESHOLDS.ttfbP95Ms,
      observed: formatMs(ttfbP95),
      threshold: `${GATE_THRESHOLDS.ttfbP95Ms}ms`,
      denominator: completedRecords.reduce((sum, record) => sum + record.latency.ttfbSamples, 0),
      margin: ttfbP95 === null ? "n/a" : `${ttfbP95 - GATE_THRESHOLDS.ttfbP95Ms}ms`,
    },
    {
      gate: `total p95 < ${GATE_THRESHOLDS.totalP95Ms}ms`,
      pass: totalP95 !== null && totalP95 < GATE_THRESHOLDS.totalP95Ms,
      observed: formatMs(totalP95),
      threshold: `${GATE_THRESHOLDS.totalP95Ms}ms`,
      denominator: completedTurnCount,
      margin: totalP95 === null ? "n/a" : `${totalP95 - GATE_THRESHOLDS.totalP95Ms}ms`,
    },
    {
      gate: `turn${GATE_THRESHOLDS.lateTurnStart}以降の反復 ${GATE_THRESHOLDS.lateTurnNearDupCount}件`,
      pass: lateDupes <= GATE_THRESHOLDS.lateTurnNearDupCount,
      observed: `${lateDupes}`,
      threshold: `${GATE_THRESHOLDS.lateTurnNearDupCount}`,
      denominator: lateTurns,
      margin: `+${lateDupes - GATE_THRESHOLDS.lateTurnNearDupCount}`,
    },
    {
      gate: `turn${GATE_THRESHOLDS.lateTurnStart}以降の total p95 < ${GATE_THRESHOLDS.lateTurnTotalP95Ms}ms`,
      // 後半まで届いた run が1つも無い場合、この基準は測れてへん。通したことにせん。
      // 後半で応答が返らんかったターンも同じで、その run の後半の応答時間は未測定。
      pass:
        lateP95 !== null && lateUnanswered === 0 && lateP95 < GATE_THRESHOLDS.lateTurnTotalP95Ms,
      observed:
        lateTurns === 0
          ? "後半のturnが無い"
          : lateUnanswered > 0
            ? `応答無し${lateUnanswered}件`
            : formatMs(lateP95),
      threshold: `${GATE_THRESHOLDS.lateTurnTotalP95Ms}ms`,
      denominator: lateTurns,
      margin: lateP95 === null ? "n/a" : `${lateP95 - GATE_THRESHOLDS.lateTurnTotalP95Ms}ms`,
    },
    {
      gate: `${GATE_THRESHOLDS.slowTurnMs / 1000}秒超の応答 0件`,
      pass: slowTurnCount === 0,
      observed: `${slowTurnCount}`,
      threshold: "0",
      denominator: completedTurnCount,
      margin: `+${slowTurnCount}`,
    },
  ];
};

export const allGatesPass = (verdicts: readonly GateVerdict[]): boolean =>
  verdicts.length > 0 && verdicts.every((verdict) => verdict.pass);
