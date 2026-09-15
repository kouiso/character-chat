#!/usr/bin/env tsx
/**
 * APIリプレイ結果(replay-chat.ts の OUT_DIR)を rubric 採点し、品質履歴TSVへ追記する。
 * fujisoft_automate の品質管理方式(定期実行→採点→履歴追記→閾値ゲート)の移植。
 *
 * 使い方:
 *   pnpm exec tsx script/e2e/score-replay.ts --dir=.work/e2e-results/replay-xxx \
 *     [--tsv=doc/quality-history.tsv] [--note="..."] [--gate]
 *
 * --gate 指定時: スコアが直近3回平均から10点以上落ちていたら exit 2
 * （TSVへの追記は済ませてから落ちるので、履歴は必ず残る）。
 *
 * 注意: リプレイ経路では failedCheck(ブラウザ実走のquality-guard結果)が取れないため、
 * characterConsistency / noMetaRemarks 軸は満点側に寄る「replayプロキシ採点」。
 * 履歴内で同方式同士を比較する分には回帰検知として機能する。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

import { judgePhaseWithLlm } from "./judges/scene-phase-llm";
import type { LlmPhaseJudgeMessage } from "./judges/scene-phase-llm";
import { summarizeLateTurns } from "./late-turn-metrics";
import { scoreScenario } from "./judges/rubric";
import { getDefaultModelForPhase } from "../../src/lib/model";
import s1MidnightMeeting from "./scenario/s1-midnight-meeting";
import s6RinkaLab from "./scenario/s6-rinka-lab";
import s7SayaRain from "./scenario/s7-saya-rain";
import s8ReinaReversal from "./scenario/s8-reina-reversal";
import type { ScenarioDefinition } from "./scenario/_types";
import type { Phase, ScenarioResult, TurnResult } from "./types";

const SCENARIO_DEFS: Record<string, ScenarioDefinition> = {
  "s1-midnight-meeting": s1MidnightMeeting,
  "s6-rinka-lab": s6RinkaLab,
  "s7-saya-rain": s7SayaRain,
  "s8-reina-reversal": s8ReinaReversal,
};

type ReplayTurn = {
  turn: number;
  phase: Phase;
  serverPhase?: Phase | null;
  userMsg: string;
  assistant: string;
  ttfbMs: number | null;
  totalMs: number | null;
  servedModel: string | null;
  refusal: boolean;
  nearDuplicate: boolean;
  exactDuplicate: boolean;
  error: string | null;
};

type ReplayFile = {
  scenario: string;
  characterSlug: string;
  startedAt: string;
  results: ReplayTurn[];
};

const getArg = (name: string): string | undefined =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");

const dir = getArg("dir");
if (!dir) {
  console.error("Usage: score-replay.ts --dir=<replay OUT_DIR> [--tsv=...] [--note=...] [--gate]");
  process.exit(1);
}
const tsvPath = getArg("tsv");
const note = getArg("note") ?? "";
const gate = process.argv.includes("--gate");

const percentile = (xs: number[], p: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

const CLASSIFIER_WINDOW = 6;

const toScenarioResult = async (file: ReplayFile): Promise<ScenarioResult> => {
  const def = SCENARIO_DEFS[file.scenario];
  let previousDetected: Phase | null = null;
  const recentDetected: Phase[] = [];
  const recentMessages: LlmPhaseJudgeMessage[] = [];
  const turns: TurnResult[] = [];
  for (const t of file.results.filter((r) => r.error === null)) {
    const defTurn = def?.turns.find((d) => d.turnIndex === t.turn);
    // LLM judge は直近の user/assistant ペアを使ってシーンを読む。
    // score-replay はサーバーが実際に返した phase ヘッダを持たない旧 artifact もあるので、
    // ヘッダが無い場合はリプレイで指定された expected phase をフォールバックとする。
    recentMessages.push({ role: "user", content: t.userMsg });
    const recentTurnsForClassifier = recentMessages.slice(-CLASSIFIER_WINDOW);
    const judgment = await judgePhaseWithLlm({
      assistantMsg: t.assistant,
      expectedPhase: t.phase,
      previousDetected,
      recentDetected: [...recentDetected],
      recentTurnsForClassifier,
    });
    previousDetected = judgment.detected;
    recentDetected.push(judgment.detected);
    if (recentDetected.length > CLASSIFIER_WINDOW + 1) recentDetected.shift();
    turns.push({
      turnIndex: t.turn,
      userMsg: t.userMsg,
      assistantMsg: t.assistant,
      isCreampie: defTurn?.isCreampie ?? false,
      expectedPhase: t.phase,
      phase: t.serverPhase ?? t.phase,
      detectedPhase: judgment.detected,
      phaseMonotonicViolation: judgment.monotonicViolation,
      usedModel: t.servedModel,
      qualityRetries: 0,
      // replay経路では quality-guard の failedCheck が取れない。refusal だけは
      // hardRefusalDetect で判定済みなので meta 軸相当の減点対象として写像する。
      failedCheck: t.refusal ? "meta_remark" : null,
      renderedMessageCount: 0,
      persistedMessageCount: 0,
      firstTokenMs: t.ttfbMs,
      lastChunkMs: t.totalMs,
      hasDoneSignal: true,
      screenshotPath: "",
      wallClockMs: t.totalMs ?? 0,
    });
    recentMessages.push({ role: "assistant", content: t.assistant });
  }
  return {
    scenarioId: file.scenario,
    characterSlug: file.characterSlug,
    status: "completed",
    startedAt: file.startedAt,
    finishedAt: null,
    turns,
    terminationReason: null,
  } as unknown as ScenarioResult;
};

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ReplayFile)
  .filter((f) => Array.isArray(f.results));

if (files.length === 0) {
  console.error(`No replay JSON found in ${dir}`);
  process.exit(1);
}

// fujisoft_automate の noise filter: 合計ターン数が 21 未満のランは採点スキップ
const totalTurns = files.reduce((sum, f) => sum + f.results.length, 0);
const MIN_SCENARIO_TURNS = 21;
if (totalTurns < MIN_SCENARIO_TURNS) {
  console.log(
    `[noise-filter] total turns=${totalTurns} < ${MIN_SCENARIO_TURNS} — skipping scoring (incomplete run)`,
  );
  process.exit(0);
}

const perScenario = await Promise.all(files.map(async (file) => {
  const rubric = scoreScenario(await toScenarioResult(file), []);
  const okTurns = file.results.filter((t) => t.error === null);
  const refusals = okTurns.filter((t) => t.refusal).length;
  const nearDups = okTurns.filter((t) => t.nearDuplicate).length;
  const ttfbs = okTurns.map((t) => t.ttfbMs).filter((v): v is number => v !== null);
  const totals = okTurns.map((t) => t.totalMs).filter((v): v is number => v !== null);
  return {
    scenario: file.scenario,
    score: rubric.eventWeightedTotal,
    rawTotal: rubric.rawTotal,
    turns: okTurns.length,
    errorTurns: file.results.length - okTurns.length,
    refusals,
    nearDupRate: okTurns.length > 0 ? nearDups / okTurns.length : 0,
    avgTtfbMs:
      ttfbs.length > 0 ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : null,
    p95TotalMs: percentile(totals, 95),
  };
}));

// fujisoft_automate の堅牢性チェック: 全シナリオが死んでる(有効ターン0 or 0点)ランは
// 品質シグナルやなくインフラ故障。rubric は有効ターン0でも基礎点(40前後)を付けるため、
// score だけでなく turns===0 も死判定に含める。履歴に積むと平均を汚染して
// 偽の回帰検知を起こすため、除外して採点スキップする。
if (perScenario.every((s) => s.score === 0 || s.turns === 0)) {
  console.error(
    `[noise-filter] all ${perScenario.length} scenarios dead (0 valid turns or score=0) — infra failure suspected, skipping history append`,
  );
  process.exit(0);
}

const avg = (xs: number[]): number | null =>
  xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

const summary = {
  date: new Date().toISOString().slice(0, 10),
  sha: execSync("git rev-parse --short HEAD").toString().trim(),
  eroticModel: getDefaultModelForPhase("erotic"),
  scenarios: perScenario.map((s) => s.scenario).join(","),
  scoreAvg: avg(perScenario.map((s) => s.score)),
  refusals: perScenario.reduce((a, s) => a + s.refusals, 0),
  nearDupRate:
    Math.round((perScenario.reduce((a, s) => a + s.nearDupRate, 0) / perScenario.length) * 1000) /
    1000,
  avgTtfbMs: avg(perScenario.map((s) => s.avgTtfbMs).filter((v): v is number => v !== null)),
  p95TotalMs: avg(perScenario.map((s) => s.p95TotalMs).filter((v): v is number => v !== null)),
  errorTurns: perScenario.reduce((a, s) => a + s.errorTurns, 0),
  note,
  lateTurns: summarizeLateTurns(files.flatMap((file) => file.results)),
};

console.log("== per-scenario ==");
for (const s of perScenario) {
  console.log(
    `${s.scenario}: score=${s.score} raw=${Math.round(s.rawTotal)} turns=${s.turns} refusals=${s.refusals} nearDup=${(s.nearDupRate * 100).toFixed(0)}% avgTTFB=${s.avgTtfbMs}ms p95Total=${s.p95TotalMs}ms`,
  );
}
console.log("== summary ==");
console.log(JSON.stringify(summary, null, 2));

const TSV_HEADER =
  "date\tsha\terotic_model\tscenarios\tscore_avg\trefusals\tnear_dup_rate\tavg_ttfb_ms\tp95_total_ms\terror_turns\tnote";

let regression: { current: number; baseline: number; threshold: number } | null = null;

if (tsvPath) {
  const abs = resolve(tsvPath);
  mkdirSync(dirname(abs), { recursive: true });
  const prevRows = existsSync(abs)
    ? readFileSync(abs, "utf8")
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.split("\t"))
        .filter((cols) => cols.length >= 5 && !Number.isNaN(Number(cols[4])))
    : [];

  const row = [
    summary.date,
    summary.sha,
    summary.eroticModel,
    summary.scenarios,
    summary.scoreAvg ?? "",
    summary.refusals,
    summary.nearDupRate,
    summary.avgTtfbMs ?? "",
    summary.p95TotalMs ?? "",
    summary.errorTurns,
    summary.note.replaceAll("\t", " "),
  ].join("\t");

  if (!existsSync(abs)) writeFileSync(abs, `${TSV_HEADER}\n`);
  appendFileSync(abs, `${row}\n`);
  console.log(`[quality-history] appended to ${abs}`);

  // fujisoft report.py の個別シナリオTSV: シナリオ単位の時系列を別ファイルに積み、
  // 集計平均では見えへん「特定シナリオ(キャラ)だけの品質退行」を追えるようにする。
  const perScenarioTsvPath = abs.replace(/\.tsv$/, "-per-scenario.tsv");
  const PER_SCENARIO_HEADER =
    "date\tsha\tscenario\tscore\traw_total\tturns\terror_turns\trefusals\tnear_dup_rate\tavg_ttfb_ms\tp95_total_ms";
  if (!existsSync(perScenarioTsvPath))
    writeFileSync(perScenarioTsvPath, `${PER_SCENARIO_HEADER}\n`);
  for (const s of perScenario) {
    appendFileSync(
      perScenarioTsvPath,
      [
        summary.date,
        summary.sha,
        s.scenario,
        s.score,
        Math.round(s.rawTotal),
        s.turns,
        s.errorTurns,
        s.refusals,
        Math.round(s.nearDupRate * 1000) / 1000,
        s.avgTtfbMs ?? "",
        s.p95TotalMs ?? "",
      ].join("\t") + "\n",
    );
  }
  console.log(`[quality-history] per-scenario rows appended to ${perScenarioTsvPath}`);

  // 閾値ゲート: 直近3回平均から10点以上の下落 = 静かな品質退行として検知
  if (gate && summary.scoreAvg !== null && prevRows.length >= 1) {
    const recent = prevRows.slice(-3).map((cols) => Number(cols[4]));
    const baseline = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (summary.scoreAvg < baseline - 10) {
      regression = {
        current: summary.scoreAvg,
        baseline: Math.round(baseline * 10) / 10,
        threshold: 10,
      };
    }
  }
}

if (regression) {
  console.error(
    `QUALITY REGRESSION: score ${regression.current} < baseline(last3 avg) ${regression.baseline} - ${regression.threshold}`,
  );
  writeFileSync(join(dir, "regression.json"), JSON.stringify({ ...regression, summary }, null, 2));
  process.exit(2);
}
