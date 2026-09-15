#!/usr/bin/env tsx
// bench P0 — 既に生成済みの応答に機械7軸を当てる。
//
// LLM も D1 も本番も叩かん。完全オフライン・課金ゼロ。
//
// 既定で source ごとに分けて出すのは、model-ab と vlong-dogfood が日付・設定・長さで
// 完全に共線しとるから。1つの表へ並べた瞬間、差が何の分か言えんくなる。
// 使い方は doc/bench-measurement.md に置く。

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { measureAll, type TurnMeasurement } from "./axes";
import {
  loadBenchRuns,
  loadModelAbStages,
  loadVlongDogfood,
  markTurnsAfterBrokenContext,
  normalizeTurn,
  type BenchTurn,
} from "./corpus";
import {
  detectTaper,
  groupSummaries,
  partitionForReport,
  renderDefectTable,
  renderIntegrityCheck,
  renderLengthVsSlopTable,
  renderRepeatSensitivityTable,
  renderTaperSummary,
  SOURCE_CONFOUND_WARNING,
  summarize,
  toJsonlRecord,
  type GroupBy,
} from "./report";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const VLONG_DIR = path.join(PROJECT_ROOT, ".work", "e2e-results", "vlong-dogfood");
const MODEL_AB_FILES = [0, 1, 2].map((stage) =>
  path.join(PROJECT_ROOT, ".work", "e2e-results", `model-ab-stage${stage}.json`),
);
const DEFAULT_BENCH_RUNS_DIR = path.join(PROJECT_ROOT, ".work", "e2e-results", "bench-runs");

const GROUP_BY_VALUES: readonly GroupBy[] = [
  "run",
  "turn",
  "phase",
  "model",
  "source",
  "scenario",
  "config",
  "arm",
  "responseLength",
];

type Options = {
  groupBy: GroupBy[];
  sources: Set<BenchTurn["source"]>;
  jsonlPath: string | null;
  /** bench:generate --out で別の場所へ書いた run を測る口 */
  benchRunsDir: string;
  showTaper: boolean;
  /** source を跨いだ集計を許すか。既定は禁止（交絡から出られんため） */
  compareSources: boolean;
};

const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    groupBy: ["run"],
    sources: new Set<BenchTurn["source"]>(["vlong-dogfood", "model-ab", "bench-run"]),
    jsonlPath: null,
    benchRunsDir: DEFAULT_BENCH_RUNS_DIR,
    showTaper: true,
    compareSources: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} に値が要る`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--group-by": {
        const requested = next().split(",");
        const invalid = requested.filter((r) => !(GROUP_BY_VALUES as string[]).includes(r));
        if (invalid.length > 0) {
          throw new Error(
            `--group-by の値が不正: ${invalid.join(", ")}（使えるのは ${GROUP_BY_VALUES.join(", ")}）`,
          );
        }
        options.groupBy = requested as GroupBy[];
        break;
      }
      case "--source": {
        const value = next();
        if (value !== "vlong-dogfood" && value !== "model-ab" && value !== "bench-run") {
          throw new Error(
            `--source は vlong-dogfood / model-ab / bench-run のどれか（受け取った値: ${value}）`,
          );
        }
        options.sources = new Set([value]);
        break;
      }
      case "--jsonl":
        options.jsonlPath = next();
        break;
      case "--bench-runs":
        options.benchRunsDir = path.resolve(next());
        break;
      case "--no-taper":
        options.showTaper = false;
        break;
      case "--compare-sources":
        options.compareSources = true;
        break;
      default:
        throw new Error(`知らん引数: ${arg}`);
    }
  }
  return options;
};

/**
 * 交絡の警告を出すか。**実際に2つ以上の source が混ざっとる時だけ言う。**
 * `--compare-sources` を付けると partition は必ず1つになるので、partition の数で
 * 判定しとった間は `--source vlong-dogfood` 単独でも「model-ab と混ぜた」と
 * 警告しとった。毎回出る警告は読まれんようになる。
 */
export const shouldWarnAboutSources = (
  measurements: TurnMeasurement[],
  compareSources: boolean,
): boolean => compareSources && new Set(measurements.map((m) => m.turn.source)).size > 1;

const loadCorpus = (sources: Set<BenchTurn["source"]>, benchRunsDir: string): BenchTurn[] => {
  const turns: BenchTurn[] = [];
  if (sources.has("vlong-dogfood")) {
    if (existsSync(VLONG_DIR)) turns.push(...loadVlongDogfood(VLONG_DIR));
    else console.warn(`[warn] ${VLONG_DIR} が無い。vlong-dogfood を飛ばす`);
  }
  if (sources.has("model-ab")) {
    const present = MODEL_AB_FILES.filter((file) => existsSync(file));
    const missing = MODEL_AB_FILES.filter((file) => !existsSync(file));
    for (const file of missing) console.warn(`[warn] ${file} が無い。飛ばす`);
    if (present.length > 0) turns.push(...loadModelAbStages(present));
  }
  if (sources.has("bench-run") && existsSync(benchRunsDir)) {
    turns.push(...loadBenchRuns(benchRunsDir));
  }
  return markTurnsAfterBrokenContext(turns.map(normalizeTurn));
};

const writeJsonl = (measurements: TurnMeasurement[], target: string): void => {
  mkdirSync(path.dirname(target), { recursive: true });
  const body = measurements.map((m) => JSON.stringify(toJsonlRecord(m))).join("\n");
  writeFileSync(target, `${body}\n`, "utf-8");
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const turns = loadCorpus(options.sources, options.benchRunsDir);
  if (turns.length === 0) {
    console.error("コーパスが空。.work/e2e-results/ に応答が無い。");
    process.exit(1);
  }
  const measurements = measureAll(turns);

  console.log(`# bench — 機械軸\n`);
  console.log(`コーパス: ${measurements.length} ターン（${[...options.sources].join(" + ")}）\n`);

  // 整合性チェックを先に出す。ここが 0 でないと以降の数字が信用でけへん。
  console.log(`## 0. 数字の土台の点検\n`);
  console.log(`${renderIntegrityCheck(measurements)}\n`);

  const partitions = partitionForReport(measurements, options.compareSources);
  if (shouldWarnAboutSources(measurements, options.compareSources))
    console.log(`${SOURCE_CONFOUND_WARNING}\n`);

  for (const partition of partitions) {
    const scoped = partition.measurements;
    console.log(`# ${partition.key}（${scoped.length} ターン）\n`);
    console.log(`## 1. 全体（長さ・水増し・反復を対で）\n`);
    console.log(`${renderLengthVsSlopTable([summarize("全体", scoped)])}\n`);
    console.log(`## 2. 全体の不良\n`);
    console.log(`${renderDefectTable([summarize("全体", scoped)])}\n`);
    console.log(`## 3. 句反復の閾値感度\n`);
    console.log(`${renderRepeatSensitivityTable(scoped)}\n`);

    for (const by of options.groupBy) {
      const summaries = groupSummaries(scoped, by);
      console.log(`## 4. ${by} 別 — 長さ と 水増し\n`);
      console.log(`${renderLengthVsSlopTable(summaries)}\n`);
      console.log(`## 5. ${by} 別 — 不良\n`);
      console.log(`${renderDefectTable(summaries)}\n`);
    }

    if (options.showTaper) {
      console.log(`## 6. 尻すぼみ検査\n`);
      console.log(`${renderTaperSummary(detectTaper(scoped))}\n`);
    }
  }

  if (options.jsonlPath) {
    writeJsonl(measurements, options.jsonlPath);
    console.log(`JSONL: ${options.jsonlPath}（${measurements.length} 行）`);
  }
};

// import しただけで 1,000ターンのコーパスを読んで報告を吐かん。直接起動した時だけ
// （cli.test.ts が shouldWarnAboutSources を import した時に走ってもうとった）
if (process.argv[1] !== undefined && process.argv[1].endsWith("cli.ts")) main();
