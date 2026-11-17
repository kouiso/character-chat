#!/usr/bin/env tsx
// RIT-96 モデル比較。本番の V2_MODEL_CHAIN の並びと同じ役（既定・逃げ道1・逃げ道2・
// 旧既定）の 4 モデルを同じ台本・同じ試験台で順に回し、数字を 1 枚の表に並べる。
//
// モデルごとの計測: 想起試験台（RIT-99 の memory-recall-check を --mode real --arms
// retrieval で呼ぶ。腕は retrieval だけ・2 回）＋成人向け台本 Sakura/Downer 各
// --script-turns ターン（script-run.ts の runCharacter をそのまま使う）。
// 台本の返事は拒否判定したらすぐ捨てる（writeTranscript:false で本文を残さん。FR-6）。
//
// 使い方:
//   tsx src/model-compare.ts [--out path] [--dry-run] [--models 名前,名前]
//       [--recall-runs n] [--script-turns n]
// 終了コード: 0=正常, 4=鍵不足, 5=見込み費用超過・時間超過, 1=その他の失敗。
// 鍵: OPENROUTER_API_KEY・CLOUDFLARE_ACCOUNT_ID・CLOUDFLARE_API_TOKEN。
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createPlatform, REPO_ROOT } from "@v2/cf";
import { applyLocalMigrations } from "@v2/cf/migrate";
import { createDb, type V2Db } from "@v2/db";
import { createOpenRouterModel, hardRefusalDetect, type ModelEnv } from "@v2/engine";
import { z } from "zod";

import {
  modelCompareReportSchema,
  type ModelCompareReport,
  type ModelCompareRow,
  type StoppedAfterTurn,
} from "./memory-bench/report";
import {
  resolveCharacter,
  runCharacter,
  scriptCharacters,
  type RunContext,
  type ScriptCharacter,
  type TurnRecord,
} from "./script-run";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// 役の名前は本番で効いている apps/v2/wrangler.jsonc の V2_MODEL_CHAIN の並びに合わせる
// （コード側 ESCAPE_MODELS とは順が食い違うが、比較は 1 本ずつ回すので数字には効かん。
// 食い違い自体は RIT-104 の持ち分）。
export type ModelRole = "default" | "escape1" | "escape2" | "previous-default";

export type ModelSpec = {
  role: ModelRole;
  model: string;
  providerOnly?: string[];
};

export const COMPARE_MODELS: readonly ModelSpec[] = [
  { role: "default", model: "deepseek/deepseek-v4.1-flash-1017" },
  {
    role: "escape1",
    model: "deepseek/deepseek-v4.1-flash",
    providerOnly: ["Venice"],
  },
  { role: "escape2", model: "cognitivecomputations/dolphin-mistral-24b-venice-edition" },
  { role: "previous-default", model: "deepseek/deepseek-v3.2" },
];

const ROLE_LABELS: Record<ModelRole, string> = {
  default: "既定",
  escape1: "逃げ道1",
  escape2: "逃げ道2",
  "previous-default": "旧既定",
};

// 表でモデルを指す文字列。providerOnly が在る時は "model [Venice]"（票の label 約束）。
export const labelOf = (spec: ModelSpec): string =>
  spec.providerOnly ? `${spec.model} [${spec.providerOnly.join(",")}]` : spec.model;

// ---- 計測の依頼口（試験では全部差し替える。本番実装はこのファイルの下の方）----

// OpenRouter の /api/v1/models から取る単価（USD/token）。
export type PriceTable = Record<string, { inputUsd: number; outputUsd: number }>;

// 想起試験台 1 回分の、比較に要る部分だけ。本体の報告（MemoryRecallReport）から抽出する。
export type RecallRunOk = {
  ok: true;
  correct: number;
  asked: number;
  ratio: number;
  byDistance: {
    "50": { correct: number; asked: number };
    "200": { correct: number; asked: number };
  };
  firstChunkMs: (number | null)[];
  totalMs: number[];
  estimatedUsd: number | null;
};

export type RecallRunFailed = { ok: false; detail: string };
export type RecallRunOutcome = RecallRunOk | RecallRunFailed;

export type ModelCompareDeps = {
  env: Record<string, string | undefined>;
  fetchPrices: (apiKey: string) => Promise<PriceTable>;
  runRecall: (spec: ModelSpec) => Promise<RecallRunOutcome>;
  runScript: (
    ctx: RunContext,
    db: V2Db,
    model: BaseChatModel,
    entry: ScriptCharacter,
  ) => Promise<TurnRecord[]>;
  // 台本を回す手元 D1（script-run の main と同じ手順: migrations → platform → createDb）。
  prepareScriptDb: () => Promise<{ db: V2Db; dispose: () => Promise<void> }>;
  // キャラの行が無い時に例外を投げる（resolveCharacter と同じ判定）。
  checkScriptCharacters: (db: V2Db) => Promise<void>;
  // モデル 1 本だけの列の先頭を返す（逃げ道へ落とさん。落とすと拒否が隠れる）。
  makeScriptModel: (env: ModelEnv) => BaseChatModel;
  now: () => number;
  gitSha: () => string;
  log: (line: string) => void;
  err: (line: string) => void;
};

export type ModelCompareOptions = {
  models: readonly ModelSpec[];
  recallRuns: number;
  scriptTurns: number;
  deadlineMs: number;
  usdCap: number;
  dryRun: boolean;
  outPath?: string;
  docPath: string;
  sourceCommand: string;
};

// ---- 決め事の定数（値は票の「未決」の既定案）----

const REQUIRED_KEYS = [
  "OPENROUTER_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

// NFR-1: 想起 1 回あたり見込み 440 回・上限 500 回の呼び出し（RIT-99 FR-13）。
const RECALL_CALLS_EST_PER_RUN = 440;
const RECALL_CALLS_CAP_PER_RUN = 500;
// 見込み費用の概算に使う 1 呼び出しあたりのトークン数（未確認の見込み。指示文が
// 大きいので入力寄りに見積もる）。
const EST_INPUT_TOKENS_PER_CALL = 8_000;
const EST_OUTPUT_TOKENS_PER_CALL = 800;
// モデル全体でこの回数続けて失敗したら配信不能と見なす（FR-8）。
const MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_DEADLINE_MS = 8 * 60 * 60 * 1000;
const DEFAULT_USD_CAP = 10;

// ---- 集計 ----

// 直近成功時点から連続して失敗した呼び出しの数も一緒に持つ（「3 回続けて」の判定用）。
type Measurements = {
  recallRuns: { correct: number; asked: number; ratio: number }[];
  byDistance: {
    "50": { correct: number; asked: number };
    "200": { correct: number; asked: number };
  };
  firstChunkMs: number[];
  totalMs: number[];
  refused: number;
  empty: number;
  turns: number;
  stoppedAfterTurn: StoppedAfterTurn;
  usdSum: number;
  usdSeen: boolean;
  failedCalls: number;
  consecutiveFailures: number;
};

const freshMeasurements = (): Measurements => ({
  recallRuns: [],
  byDistance: { "50": { correct: 0, asked: 0 }, "200": { correct: 0, asked: 0 } },
  firstChunkMs: [],
  totalMs: [],
  refused: 0,
  empty: 0,
  turns: 0,
  stoppedAfterTurn: { Sakura: null, Downer: null },
  usdSum: 0,
  usdSeen: false,
  failedCalls: 0,
  consecutiveFailures: 0,
});

// 中央値・90 パーセンタイルは nearest-rank で取る。空なら null。
const percentileOf = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};

type FailReason = NonNullable<ModelCompareRow["reason"]>;

// 失敗の理由を分類する。404・配信停止は not_found、それ以外の連続失敗は upstream_error。
export const classifyFailure = (detail: string): FailReason => {
  if (/読めん|行が無い/.test(detail)) return "character_missing";
  if (/404|not.?found|no endpoints|does not exist/i.test(detail)) return "not_found";
  return "upstream_error";
};

const collectRecall = (m: Measurements, run: RecallRunOk): void => {
  m.recallRuns.push({ correct: run.correct, asked: run.asked, ratio: run.ratio });
  for (const d of ["50", "200"] as const) {
    m.byDistance[d].correct += run.byDistance[d].correct;
    m.byDistance[d].asked += run.byDistance[d].asked;
  }
  m.firstChunkMs.push(...run.firstChunkMs.filter((v): v is number => v !== null));
  m.totalMs.push(...run.totalMs);
  if (run.estimatedUsd !== null) {
    m.usdSum += run.estimatedUsd;
    m.usdSeen = true;
  }
};

// 台本 1 ターン分の計上。本文は判定の後すぐ捨てる（どこにも残さん）。
const collectTurn = (m: Measurements, record: TurnRecord): void => {
  m.turns += 1;
  m.totalMs.push(record.latencyMs);
  if (record.error) {
    m.failedCalls += 1;
    m.consecutiveFailures += 1;
  } else {
    m.consecutiveFailures = 0;
  }
  // 空の返事（0 字）は拒否と別に empty へ数える。hardRefusalDetect は 20 字未満を
  // 拒否と見なすので、先に 0 字を抜かんと空が拒否へ二重計上される。
  if (record.text.length === 0) {
    m.empty += 1;
    return;
  }
  if (hardRefusalDetect(record.text)) m.refused += 1;
};

// ---- モデルごとの実行 ----

type SharedRun = {
  db: V2Db;
  ctx: RunContext;
  scriptEntries: ScriptCharacter[];
  options: ModelCompareOptions;
  deadlineExceeded: () => boolean;
  envFor: (spec: ModelSpec) => ModelEnv;
};

// 失敗を計上し、not_found・3 連続なら理由を返す（呼ぶ側はそのモデルを打ち切る）。
const noteFailure = (m: Measurements, detail: string): FailReason | null => {
  m.failedCalls += 1;
  m.consecutiveFailures += 1;
  const reason = classifyFailure(detail);
  if (reason !== "upstream_error") return reason;
  return m.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? "upstream_error" : null;
};

const runRecallPhase = async (
  deps: ModelCompareDeps,
  spec: ModelSpec,
  m: Measurements,
  shared: SharedRun,
): Promise<FailReason | null> => {
  for (let i = 0; i < shared.options.recallRuns; i += 1) {
    if (shared.deadlineExceeded()) return "aborted";
    const outcome = await deps.runRecall(spec);
    if (outcome.ok) {
      m.consecutiveFailures = 0;
      collectRecall(m, outcome);
      continue;
    }
    const reason = noteFailure(m, outcome.detail);
    if (reason) return reason;
  }
  return null;
};

const markStopped = (m: Measurements, entry: ScriptCharacter, stop: number | null): void => {
  if (entry.label === "Sakura") m.stoppedAfterTurn.Sakura = stop;
  if (entry.label === "Downer") m.stoppedAfterTurn.Downer = stop;
};

const runOneScript = async (
  deps: ModelCompareDeps,
  m: Measurements,
  shared: SharedRun,
  model: BaseChatModel,
  entry: ScriptCharacter,
): Promise<FailReason | null> => {
  let records: TurnRecord[];
  try {
    records = await deps.runScript(shared.ctx, shared.db, model, entry);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // 投げただけでは次の台本へ進む（3 連続または not_found/character_missing で止まる）。
    return noteFailure(m, detail);
  }
  const planned = shared.ctx.turnsLimit
    ? Math.min(entry.script.length, shared.ctx.turnsLimit)
    : entry.script.length;
  for (const record of records) {
    collectTurn(m, record);
    if (m.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return "upstream_error";
  }
  // 台本が途中で止まった時は止まったターン番号、回り切った時は null。
  const stopped = records.length < planned ? (records.at(-1)?.turn ?? null) : null;
  markStopped(m, entry, stopped);
  return null;
};

const runScriptPhase = async (
  deps: ModelCompareDeps,
  spec: ModelSpec,
  m: Measurements,
  shared: SharedRun,
): Promise<FailReason | null> => {
  const model = deps.makeScriptModel(shared.envFor(spec));
  for (const entry of shared.scriptEntries) {
    if (shared.deadlineExceeded()) return "aborted";
    const reason = await runOneScript(deps, m, shared, model, entry);
    if (reason) return reason;
  }
  return null;
};

const buildRecallSection = (m: Measurements): ModelCompareRow["recall"] => {
  if (m.recallRuns.length === 0) return null;
  const mean = m.recallRuns.reduce((sum, run) => sum + run.ratio, 0) / m.recallRuns.length;
  const spread =
    m.recallRuns.length >= 2 ? Math.abs(m.recallRuns[0].ratio - m.recallRuns[1].ratio) : 0;
  return { runs: m.recallRuns, mean, spread, byDistance: m.byDistance };
};

const buildLatencySection = (m: Measurements): ModelCompareRow["latency"] => {
  if (m.totalMs.length === 0) return null;
  return {
    firstChunkP50: percentileOf(m.firstChunkMs, 50),
    firstChunkP90: percentileOf(m.firstChunkMs, 90),
    totalP50: percentileOf(m.totalMs, 50) ?? 0,
    totalP90: percentileOf(m.totalMs, 90) ?? 0,
  };
};

const rowOf = (
  spec: ModelSpec,
  m: Measurements,
  status: ModelCompareRow["status"],
  reason: ModelCompareRow["reason"],
): ModelCompareRow => ({
  model: spec.model,
  providerOnly: spec.providerOnly ?? null,
  label: labelOf(spec),
  role: spec.role,
  status,
  reason,
  recall: buildRecallSection(m),
  refusal:
    m.turns > 0
      ? {
          refused: m.refused,
          empty: m.empty,
          turns: m.turns,
          stoppedAfterTurn: m.stoppedAfterTurn,
        }
      : null,
  latency: buildLatencySection(m),
  estimatedUsd: m.usdSeen ? m.usdSum : null,
  failedCalls: m.failedCalls,
});

const runOneModel = async (
  deps: ModelCompareDeps,
  spec: ModelSpec,
  shared: SharedRun,
): Promise<ModelCompareRow> => {
  const m = freshMeasurements();
  const unavailable = (reason: FailReason): ModelCompareRow =>
    rowOf(spec, m, "unavailable", reason);

  // 金を使う前にキャラの行を確かめる（script-run の main と同じ前検査）。
  try {
    await deps.checkScriptCharacters(shared.db);
  } catch {
    return unavailable("character_missing");
  }
  const recallReason = await runRecallPhase(deps, spec, m, shared);
  if (recallReason) return unavailable(recallReason);
  const scriptReason = await runScriptPhase(deps, spec, m, shared);
  if (scriptReason) return unavailable(scriptReason);
  return rowOf(spec, m, "ok", null);
};

// ---- 表（FR-5 の判定と markdown）----

type BehindDetail = { label: string; diff: number; threshold: number };

// 逃げ道 1・2 のそれぞれについて「逃げ道の平均 − 既定の平均」が揺れの大きい方を
// 上回る時だけ拾う（等しい時は入らん。旧既定は比べん）。
export const computeDefaultBehind = (rows: ModelCompareRow[]): BehindDetail[] => {
  const def = rows.find((row) => row.role === "default" && row.status === "ok" && row.recall);
  if (!def?.recall) return [];
  const defRecall = def.recall;
  return rows
    .filter(
      (row) =>
        (row.role === "escape1" || row.role === "escape2") && row.status === "ok" && row.recall,
    )
    .map((row) => ({
      label: row.label,
      diff: (row.recall?.mean ?? 0) - defRecall.mean,
      threshold: Math.max(defRecall.spread, row.recall?.spread ?? 0),
    }))
    .filter((detail) => detail.diff > detail.threshold);
};

const fmt = (value: number): string => Number(value.toFixed(3)).toString();
const escMd = (text: string): string => text.replace(/[[\]]/g, "\\$&");

const ratioCell = (row: ModelCompareRow, index: number): string => {
  const run = row.recall?.runs[index];
  return run ? run.ratio.toFixed(2) : "-";
};

const latencyCell = (p50: number | null, p90: number | null): string =>
  p50 === null || p90 === null ? "-/-" : `${Math.round(p50)}/${Math.round(p90)}`;

const recallCells = (row: ModelCompareRow): string[] => {
  const r = row.recall;
  return [
    ratioCell(row, 0),
    ratioCell(row, 1),
    r ? r.mean.toFixed(2) : "-",
    r ? r.spread.toFixed(2) : "-",
    r ? `${r.byDistance["50"].correct}/${r.byDistance["50"].asked}` : "-",
    r ? `${r.byDistance["200"].correct}/${r.byDistance["200"].asked}` : "-",
  ];
};

const NULL_LATENCY = {
  firstChunkP50: null,
  firstChunkP90: null,
  totalP50: null,
  totalP90: null,
} as const;

const scriptCells = (row: ModelCompareRow): string[] => {
  const f = row.refusal;
  const l = row.latency ?? NULL_LATENCY;
  return [
    f === null ? "-" : `${f.refused}/${f.turns}`,
    f === null ? "-" : `${f.empty}/${f.turns}`,
    latencyCell(l.firstChunkP50, l.firstChunkP90),
    latencyCell(l.totalP50, l.totalP90),
    row.estimatedUsd === null ? "-" : row.estimatedUsd.toFixed(4),
  ];
};

const tableRow = (row: ModelCompareRow): string => {
  const head = `| ${ROLE_LABELS[row.role]} | ${escMd(row.label)}`;
  if (row.status === "unavailable") {
    return `${head} | unavailable（${row.reason ?? "?"}） | - | - | - | - | - | - | - | - | - |`;
  }
  return [head, ...recallCells(row), ...scriptCells(row)].join(" | ");
};

// FR-7: doc/v2/model-compare.md に足す 1 回分。数字だけ（本文は入らん）。
export const buildMarkdownSection = (report: ModelCompareReport, sourceCommand: string): string => {
  const lines = [
    `## ${report.finishedAt.slice(0, 10)}（commit ${report.gitSha}）`,
    "",
    `出典: ${sourceCommand}`,
  ];
  if (report.rows.some((row) => row.reason === "aborted")) lines.push("（途中で止めた）");
  for (const detail of computeDefaultBehind(report.rows)) {
    lines.push(
      `既定が記憶の正答で下回った: ${escMd(detail.label)}（差 ${fmt(detail.diff)}、揺れ ${fmt(detail.threshold)}）`,
    );
  }
  lines.push(
    "",
    "| 役 | モデル | 正答 1回目 | 正答 2回目 | 平均 | 揺れ | 50ターン | 200ターン | 拒否 | 空 | 最初の字 中央値/p90 | 全部 中央値/p90 | 費用 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.rows.map(tableRow),
    "",
  );
  return `${lines.join("\n")}\n`;
};

// 新しい方を上に足す（先頭のタイトル・説明は残し、最初の "## " の前へ挿入）。
export const appendMarkdownSection = (docPath: string, section: string): void => {
  const existing = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
  const index = existing.indexOf("\n## ");
  const next =
    index >= 0
      ? `${existing.slice(0, index + 1)}${section}${existing.slice(index + 1)}`
      : `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${section}`;
  writeFileSync(docPath, next, "utf8");
};

// ---- 実行本体 ----

// 比較対象のモデル 1 本だけの列を env で作る。V2_MODEL は単モデル指定として列指定より
// 優先されるので消す（process.env は汚さん。写した側だけを触る）。
export const envForModel = (
  env: Record<string, string | undefined>,
  spec: ModelSpec,
): Record<string, string | undefined> => {
  const next = { ...env };
  delete next.V2_MODEL;
  next.V2_MODEL_CHAIN = JSON.stringify([
    { model: spec.model, ...(spec.providerOnly ? { providerOnly: spec.providerOnly } : {}) },
  ]);
  return next;
};

const estimateCalls = (options: ModelCompareOptions): { est: number; cap: number } => ({
  est: options.recallRuns * RECALL_CALLS_EST_PER_RUN + 2 * options.scriptTurns,
  cap: options.recallRuns * RECALL_CALLS_CAP_PER_RUN + 2 * options.scriptTurns,
});

// FR-9: 回す前に見込みの呼び出し回数と費用を出す。戻り値は合計の見込み費用
// （単価の取れんモデルが 1 つでも在れば null。RIT-99 の usdKnown と同じ扱い）。
const printEstimate = (
  deps: ModelCompareDeps,
  options: ModelCompareOptions,
  prices: PriceTable,
): number | null => {
  const { est, cap } = estimateCalls(options);
  let totalUsd = 0;
  let usdKnown = true;
  for (const spec of options.models) {
    const price = prices[spec.model];
    const usd = price
      ? (est *
          (EST_INPUT_TOKENS_PER_CALL * price.inputUsd +
            EST_OUTPUT_TOKENS_PER_CALL * price.outputUsd)) /
        1_000_000
      : null;
    if (usd === null) usdKnown = false;
    else totalUsd += usd;
    deps.log(
      `見込み: ${labelOf(spec)} 呼び出し ~${est} 回（上限 ${cap}）・費用 ${usd === null ? "不明" : `~$${usd.toFixed(2)}`}`,
    );
  }
  deps.log(
    `合計: 呼び出し ~${est * options.models.length} 回（上限 ${cap * options.models.length}）・` +
      `見込み費用 ${usdKnown ? `~$${totalUsd.toFixed(2)}` : "不明"}（上限 $${options.usdCap}）`,
  );
  return usdKnown ? totalUsd : null;
};

const persistReport = (
  report: ModelCompareReport,
  options: ModelCompareOptions,
  deps: ModelCompareDeps,
): void => {
  if (options.outPath) {
    mkdirSync(path.dirname(path.resolve(options.outPath)), { recursive: true });
    writeFileSync(path.resolve(options.outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  const section = buildMarkdownSection(report, options.sourceCommand);
  appendMarkdownSection(options.docPath, section);
  deps.log(section.trimEnd());
};

// モデルは並行せず順に回す（レート制限で揺れに混ざりが出るため）。
// 締切を超えたら残りの行は全部 aborted にして止める（途中までの表を出す）。
const runAllModels = async (
  deps: ModelCompareDeps,
  shared: SharedRun,
): Promise<ModelCompareRow[]> => {
  const rows: ModelCompareRow[] = [];
  let stoppedEarly = false;
  for (const spec of shared.options.models) {
    if (stoppedEarly || shared.deadlineExceeded()) {
      stoppedEarly = true;
      rows.push(rowOf(spec, freshMeasurements(), "unavailable", "aborted"));
      continue;
    }
    const row = await runOneModel(deps, spec, shared);
    rows.push(row);
    deps.log(`[${spec.role}] ${row.label} -> ${row.status}${row.reason ? `(${row.reason})` : ""}`);
  }
  return rows;
};

const assembleReport = (
  deps: ModelCompareDeps,
  rows: ModelCompareRow[],
  startedAt: number,
  estimatedUsdTotal: number | null,
): ModelCompareReport => ({
  kind: "model-compare",
  schemaVersion: 1,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date(deps.now()).toISOString(),
  gitSha: deps.gitSha(),
  rows,
  defaultBehind: computeDefaultBehind(rows).map((detail) => detail.label),
  estimatedUsdTotal,
});

export const runModelCompare = async (
  deps: ModelCompareDeps,
  options: ModelCompareOptions,
): Promise<{ code: number; report: ModelCompareReport | null }> => {
  const missing = REQUIRED_KEYS.filter((key) => !deps.env[key]);
  for (const key of missing) deps.err(`missing: ${key}`);
  if (missing.length > 0) return { code: 4, report: null };

  const prices = await deps.fetchPrices(deps.env.OPENROUTER_API_KEY ?? "");
  const totalUsd = printEstimate(deps, options, prices);
  if (options.dryRun) return { code: 0, report: null };
  if (totalUsd !== null && totalUsd > options.usdCap) {
    deps.err(`見込み費用 ~$${totalUsd.toFixed(2)} が上限 $${options.usdCap} を超えるので中止`);
    return { code: 5, report: null };
  }

  const startedAt = deps.now();
  const scriptDb = await deps.prepareScriptDb();
  try {
    const shared: SharedRun = {
      db: scriptDb.db,
      ctx: scriptCtx(startedAt, options.scriptTurns),
      scriptEntries: scriptCharacters("adult"),
      options,
      deadlineExceeded: () => deps.now() - startedAt > options.deadlineMs,
      envFor: (spec) => envForModel(deps.env, spec),
    };
    const rows = await runAllModels(deps, shared);
    const report = assembleReport(deps, rows, startedAt, totalUsd);
    modelCompareReportSchema.parse(report);
    persistReport(report, options, deps);
    return { code: rows.some((row) => row.reason === "aborted") ? 5 : 0, report };
  } finally {
    await scriptDb.dispose();
  }
};

// transcript の置き場は writeTranscript:false なので作らん・読まれん
// （RunContext の必須項目を満たすだけの名前）。
const scriptCtx = (startedAt: number, scriptTurns: number): RunContext => ({
  arm: "model-compare",
  run: "compare",
  runId: startedAt.toString(36),
  outDir: path.join(REPO_ROOT, ".work", "model-compare", startedAt.toString(36)),
  qualityLines: [],
  writeTranscript: false,
  turnsLimit: scriptTurns,
});

// ---- 本番の部品（実モデル・実 OpenRouter・手元 D1）----

const BENCH_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX_BIN = path.join(BENCH_ROOT, "node_modules", ".bin", "tsx");
const execFileAsync = promisify(execFile);

// 想起試験台の報告から比較に要る部分だけ拾う形。会話の本文は含まれん（FR-11 系）。
const recallReportSubsetSchema = z.object({
  arms: z.object({
    retrieval: z.object({
      asked: z.number().int(),
      correct: z.number().int(),
      ratio: z.number(),
      byDistance: z.object({
        "50": z.object({ correct: z.number().int(), asked: z.number().int() }),
        "200": z.object({ correct: z.number().int(), asked: z.number().int() }),
      }),
      checks: z.array(z.object({ firstChunkMs: z.number().nullable(), totalMs: z.number() })),
    }),
  }),
  estimatedUsd: z.number().nullable().optional(),
});

// 想起試験台を子プロセスで回す（RIT-99 本体の呼び出し上限・料金上限・終了コードを
// そのまま効かせるため）。--model/--provider-only で会話・抜き出し・あらすじが全部
// そのモデルになる。戻る前に --out の JSON を検証する。
const realRecallRunner =
  (timeoutMs: number): ModelCompareDeps["runRecall"] =>
  async (spec: ModelSpec): Promise<RecallRunOutcome> => {
    const outDir = mkdtempSync(path.join(tmpdir(), "model-compare-recall-"));
    const outPath = path.join(outDir, "report.json");
    const args = [
      "src/memory-recall-check.ts",
      "--mode",
      "real",
      "--model",
      spec.model,
      "--arms",
      "retrieval",
      "--out",
      outPath,
    ];
    // providerOnly フラグは 1 値だけ取る。複数固定が要るモデルが出たら子側の口を増やす。
    if (spec.providerOnly?.length) args.push("--provider-only", spec.providerOnly[0]);
    try {
      await execFileAsync(TSX_BIN, args, {
        cwd: BENCH_ROOT,
        env: envForModel(process.env, spec),
        maxBuffer: 32 * 1024 * 1024,
        timeout: timeoutMs,
      });
      const parsed = recallReportSubsetSchema.safeParse(JSON.parse(readFileSync(outPath, "utf8")));
      if (!parsed.success) return { ok: false, detail: "recall report did not match schema" };
      const retrieval = parsed.data.arms.retrieval;
      return {
        ok: true,
        correct: retrieval.correct,
        asked: retrieval.asked,
        ratio: retrieval.ratio,
        byDistance: retrieval.byDistance,
        firstChunkMs: retrieval.checks.map((check) => check.firstChunkMs),
        totalMs: retrieval.checks.map((check) => check.totalMs),
        estimatedUsd: parsed.data.estimatedUsd ?? null,
      };
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error ? String(error.stderr ?? "") : "";
      const message = error instanceof Error ? error.message : String(error);
      // 分類に要る種類（404 等）だけを残す。本文は拾わん。
      return { ok: false, detail: `${message} ${stderr}`.slice(0, 2_000) };
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  };

// OpenRouter の価格表（USD/token）。取れん時は空（見込みは「不明」で進める）。
const fetchOpenRouterPrices = async (apiKey: string): Promise<PriceTable> => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return {};
    const json = (await response.json()) as {
      data?: { id?: string; pricing?: { prompt?: string; completion?: string } }[];
    };
    const table: PriceTable = {};
    for (const entry of json.data ?? []) {
      if (!entry.id) continue;
      table[entry.id] = {
        inputUsd: Number(entry.pricing?.prompt ?? 0),
        outputUsd: Number(entry.pricing?.completion ?? 0),
      };
    }
    return table;
  } catch {
    return {};
  }
};

const realDeps = (deadlineMs: number): ModelCompareDeps => ({
  env: process.env,
  fetchPrices: fetchOpenRouterPrices,
  runRecall: realRecallRunner(deadlineMs),
  runScript: runCharacter,
  prepareScriptDb: async () => {
    applyLocalMigrations();
    const { env, dispose } = await createPlatform();
    return { db: createDb(env.DB), dispose };
  },
  checkScriptCharacters: async (db) => {
    for (const entry of scriptCharacters("adult")) await resolveCharacter(db, entry);
  },
  makeScriptModel: (env) => createOpenRouterModel(env),
  now: Date.now,
  gitSha: () =>
    execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT }).toString().trim(),
  log: (line) => console.log(line),
  err: (line) => process.stderr.write(`${line}\n`),
});

// ---- CLI ----

type CliArgs = {
  out?: string;
  dryRun: boolean;
  models?: string;
  recallRuns: number;
  scriptTurns: number;
};

const readArg = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const readPositiveInt = (value: string | undefined, name: string, fallback: number): number => {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} は 1 以上の整数: ${value}`);
  return n;
};

const parseArgs = (argv: string[]): CliArgs => ({
  out: readArg(argv, "--out"),
  dryRun: argv.includes("--dry-run"),
  models: readArg(argv, "--models"),
  recallRuns: readPositiveInt(readArg(argv, "--recall-runs"), "--recall-runs", 2),
  scriptTurns: readPositiveInt(readArg(argv, "--script-turns"), "--script-turns", 10),
});

// --models は既定の 4 本から名前で選ぶ。役の名前が崩れんよう、知らん名前は弾く。
const resolveModels = (value: string | undefined): ModelSpec[] => {
  if (!value) return [...COMPARE_MODELS];
  const names = new Set(value.split(",").map((name) => name.trim()));
  const picked = COMPARE_MODELS.filter((spec) => names.has(spec.model));
  if (picked.length !== names.size) {
    const known = new Set(picked.map((spec) => spec.model));
    const unknown = [...names].filter((name) => !known.has(name));
    throw new Error(
      `--models に既定の 4 本以外は指定できん: ${unknown.join(",")}（有効: ${COMPARE_MODELS.map((spec) => spec.model).join(", ")}）`,
    );
  }
  return [...picked];
};

const toOptions = (args: CliArgs, argv: string[]): ModelCompareOptions => ({
  models: resolveModels(args.models),
  recallRuns: args.recallRuns,
  scriptTurns: args.scriptTurns,
  deadlineMs: DEFAULT_DEADLINE_MS,
  usdCap: DEFAULT_USD_CAP,
  dryRun: args.dryRun,
  outPath: args.out,
  docPath: path.join(REPO_ROOT, "doc", "v2", "model-compare.md"),
  sourceCommand: `pnpm --filter @v2/bench model-compare${argv.length > 0 ? ` -- ${argv.join(" ")}` : ""}`,
});

const main = async (argv: string[]): Promise<number> => {
  const args = parseArgs(argv);
  const options = toOptions(args, argv);
  const deps = realDeps(options.deadlineMs);
  const { code } = await runModelCompare(deps, options);
  return code;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      // 失敗理由の中身（会話本文・プロンプト）を出さんよう、種類名だけを出す。
      const name = error instanceof Error ? error.name : "unknown";
      process.stderr.write(`error:${name}\n`);
      process.exitCode = 1;
    });
}
