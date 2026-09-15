/**
 * 記録済み e2e ラン(manifest.json)の全アシスタント返答を keyword phase judge に
 * 通し直し、ラベル分布と expectedPhase 一致率を出す。judge を触った変更が
 * 「手書きサンプル4件は直ったが実コーパス30ターンを黙って壊した」状態を可視化する。
 *
 * 使い方:
 *   pnpm e2e:replay-corpus
 *   pnpm e2e:replay-corpus --roots=.work/e2e-results,/path/to/other/.work/e2e-results
 *   pnpm e2e:replay-corpus --baseline=origin/main
 *
 * ネットワーク・API キーは一切使わない。純ローカルリプレイ。
 *
 * --baseline=<git-ref> 指定時は、その ref の scene-phase.ts を一時ファイルへ書き出して
 * dynamic import し、同じコーパスを両バージョンで評価してラベルが変わったターンだけを
 * 方向別(例 intimate→erotic)に出す。別プロセスを起動せず、同一プロセス内で
 * 2つのモジュール版を同時に持つための手段が一時ファイル + dynamic import
 * (相対 import を解決させるため judges/ 配下に置いて finally で必ず消す)。
 *
 * 近隣スクリプトと違って shebang を付けていないのは、集計ロジックを
 * replay-corpus.test.ts から import しており、vite の transform が
 * `#!` 行を構文エラーにするため。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { judgePhase } from "./scene-phase";
import type { Phase } from "../types";

const PHASES: readonly Phase[] = [
  "conversation",
  "intimate",
  "erotic",
  "climax",
  "afterglow",
] as const;

/** judgePhase と同じ形。baseline 側モジュールも同じシグネチャで呼ぶ。 */
export type PhaseJudge = (args: {
  assistantMsg: string;
  expectedPhase: Phase;
  previousDetected: Phase | null;
  recentDetected?: Phase[];
}) => { detected: Phase };

export type CorpusTurn = {
  runId: string;
  scenarioId: string;
  turnIndex: number;
  expectedPhase: Phase;
  /** manifest に記録されている当時の判定。今回の再判定とは別物。 */
  recordedPhase: Phase | null;
  assistantMsg: string;
};

export type PhaseRow = {
  phase: Phase;
  expected: number;
  judged: number;
  agreed: number;
};

export type CorpusSummary = {
  total: number;
  agreed: number;
  agreementRate: number;
  rows: PhaseRow[];
};

export type ChangedTurn = {
  turn: CorpusTurn;
  from: Phase;
  to: Phase;
  direction: "improved" | "regressed" | "neutral";
};

export type DiffSummary = {
  total: number;
  changed: ChangedTurn[];
  improved: number;
  regressed: number;
  neutral: number;
  baselineAgreementRate: number;
  headAgreementRate: number;
};

const isPhase = (value: unknown): value is Phase =>
  typeof value === "string" && (PHASES as readonly string[]).includes(value);

/** roots 配下の runs/<runId>/manifest.json を全部読んでターンを平坦化する。 */
export const collectCorpus = (roots: string[]): CorpusTurn[] => {
  const turns: CorpusTurn[] = [];
  for (const root of roots) {
    const runsDir = join(root, "runs");
    if (!existsSync(runsDir)) continue;
    for (const entry of readdirSync(runsDir).sort()) {
      const manifestPath = join(runsDir, entry, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      let manifest: unknown;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        // 途中で落ちたランは manifest が壊れていることがある。コーパスから外すだけ
        continue;
      }
      const runId =
        (manifest as { runId?: unknown }).runId != null
          ? String((manifest as { runId?: unknown }).runId)
          : entry;
      const scenarios = (manifest as { scenarios?: unknown }).scenarios;
      if (!Array.isArray(scenarios)) continue;
      for (const scenario of scenarios) {
        const scenarioId = String((scenario as { scenarioId?: unknown }).scenarioId ?? "?");
        const scenarioTurns = (scenario as { turns?: unknown }).turns;
        if (!Array.isArray(scenarioTurns)) continue;
        for (const turn of scenarioTurns) {
          const t = turn as {
            turnIndex?: unknown;
            assistantMsg?: unknown;
            expectedPhase?: unknown;
            detectedPhase?: unknown;
          };
          if (typeof t.assistantMsg !== "string" || t.assistantMsg.trim() === "") continue;
          if (!isPhase(t.expectedPhase)) continue;
          turns.push({
            runId,
            scenarioId,
            turnIndex: Number(t.turnIndex ?? 0),
            expectedPhase: t.expectedPhase,
            recordedPhase: isPhase(t.detectedPhase) ? t.detectedPhase : null,
            assistantMsg: t.assistantMsg,
          });
        }
      }
    }
  }
  return turns;
};

// scenario-runner.ts の RECENT_PHASE_WINDOW_TURNS(7) と同じ値にする。
// ここが本番経路より短いと、4ターンを超える post-climax の会話で climax が
// recentDetected から早く落ち、5〜7ターン目の afterglow 手がかりが本番と違う
// 判定になる(本番は7ターン保持するが、リプレイはその半分強しか保持しない)。
const RECENT_WINDOW = 7;

/**
 * シナリオ単位で順に判定する。judgePhase は previousDetected / recentDetected を
 * 見るので、ターンを単独で投げると本番と違う判定になる。manifest の
 * detectedPhase を鎖に使うと baseline 側の判定が head 側の履歴に汚染されるため、
 * 各バージョンが自分で出したラベルを鎖にする(自己完結リプレイ)。
 */
export const replayCorpus = (turns: CorpusTurn[], judge: PhaseJudge): Phase[] => {
  const labels: Phase[] = [];
  let currentKey: string | null = null;
  let previousDetected: Phase | null = null;
  let recentDetected: Phase[] = [];
  for (const turn of turns) {
    const key = `${turn.runId}::${turn.scenarioId}`;
    if (key !== currentKey) {
      currentKey = key;
      previousDetected = null;
      recentDetected = [];
    }
    const { detected } = judge({
      assistantMsg: turn.assistantMsg,
      expectedPhase: turn.expectedPhase,
      previousDetected,
      recentDetected,
    });
    previousDetected = detected;
    recentDetected.push(detected);
    if (recentDetected.length > RECENT_WINDOW) recentDetected.shift();
    labels.push(detected);
  }
  return labels;
};

export const summarize = (turns: CorpusTurn[], labels: Phase[]): CorpusSummary => {
  const rows: PhaseRow[] = PHASES.map((phase) => ({ phase, expected: 0, judged: 0, agreed: 0 }));
  const byPhase = new Map(rows.map((row) => [row.phase, row]));
  let agreed = 0;
  turns.forEach((turn, i) => {
    const label = labels[i];
    byPhase.get(turn.expectedPhase)!.expected += 1;
    byPhase.get(label)!.judged += 1;
    if (label === turn.expectedPhase) {
      byPhase.get(label)!.agreed += 1;
      agreed += 1;
    }
  });
  return {
    total: turns.length,
    agreed,
    agreementRate: turns.length === 0 ? 0 : agreed / turns.length,
    rows,
  };
};

export const diffLabels = (
  turns: CorpusTurn[],
  baselineLabels: Phase[],
  headLabels: Phase[],
): DiffSummary => {
  const changed: ChangedTurn[] = [];
  let baselineAgreed = 0;
  let headAgreed = 0;
  turns.forEach((turn, i) => {
    const from = baselineLabels[i];
    const to = headLabels[i];
    if (from === turn.expectedPhase) baselineAgreed += 1;
    if (to === turn.expectedPhase) headAgreed += 1;
    if (from === to) return;
    const direction =
      to === turn.expectedPhase ? "improved" : from === turn.expectedPhase ? "regressed" : "neutral";
    changed.push({ turn, from, to, direction });
  });
  return {
    total: turns.length,
    changed,
    improved: changed.filter((c) => c.direction === "improved").length,
    regressed: changed.filter((c) => c.direction === "regressed").length,
    neutral: changed.filter((c) => c.direction === "neutral").length,
    baselineAgreementRate: turns.length === 0 ? 0 : baselineAgreed / turns.length,
    headAgreementRate: turns.length === 0 ? 0 : headAgreed / turns.length,
  };
};

export const formatSummaryTable = (summary: CorpusSummary): string => {
  const lines = [
    "phase          expected  judged  agreed  recall",
    "-------------  --------  ------  ------  ------",
  ];
  for (const row of summary.rows) {
    const recall = row.expected === 0 ? "  n/a" : `${((row.agreed / row.expected) * 100).toFixed(0)}%`;
    lines.push(
      `${row.phase.padEnd(13)}  ${String(row.expected).padStart(8)}  ${String(row.judged).padStart(6)}  ${String(row.agreed).padStart(6)}  ${recall.padStart(6)}`,
    );
  }
  lines.push(
    `${"TOTAL".padEnd(13)}  ${String(summary.total).padStart(8)}  ${String(summary.total).padStart(6)}  ${String(summary.agreed).padStart(6)}`,
  );
  return lines.join("\n");
};

const truncate = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
};

const getArg = (name: string): string | undefined =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");

const DEFAULT_ROOT = ".work/e2e-results";
// import.meta.url は vitest の transform 下では file: にならないことがあるため、
// CLI 実行時にだけ解決する(テストからは main() を呼ばない)。
const baselineTmpPath = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), `.replay-baseline-${process.pid}.ts`);

/**
 * baseline ref の scene-phase.ts を judges/ 配下の一時ファイルへ出し、dynamic import する。
 * 相対 import(../types, ../../../src/lib/scene-phase)をそのまま解決させるために
 * 同じディレクトリへ置く必要がある。呼び出し側が必ず finally で消す。
 */
const loadBaselineJudge = async (ref: string, tmpPath: string): Promise<PhaseJudge> => {
  const source = execFileSync("git", ["show", `${ref}:script/e2e/judges/scene-phase.ts`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(tmpPath, source);
  const mod = (await import(pathToFileURL(tmpPath).href)) as { judgePhase: PhaseJudge };
  return mod.judgePhase;
};

const main = async (): Promise<void> => {
  const roots = (getArg("roots") ?? DEFAULT_ROOT).split(",").map((r) => resolve(r.trim()));
  const baselineRef = getArg("baseline");
  const maxText = Number(getArg("max-text") ?? 70);

  const turns = collectCorpus(roots);
  if (turns.length === 0) {
    console.error(`No corpus turns found under: ${roots.join(", ")}`);
    process.exit(1);
  }
  const runs = new Set(turns.map((t) => t.runId)).size;
  const scenarios = new Set(turns.map((t) => `${t.runId}::${t.scenarioId}`)).size;
  console.log(`roots: ${roots.join(", ")}`);
  console.log(`runs: ${runs}  scenarios: ${scenarios}  turns: ${turns.length}`);
  console.log("");

  const headLabels = replayCorpus(turns, judgePhase);

  if (!baselineRef) {
    const summary = summarize(turns, headLabels);
    console.log(formatSummaryTable(summary));
    console.log("");
    console.log(
      `SUMMARY: ${summary.total} turns replayed, agreement with expectedPhase ${summary.agreed}/${summary.total} (${(summary.agreementRate * 100).toFixed(1)}%)`,
    );
    return;
  }

  const tmpPath = baselineTmpPath();
  let baselineJudge: PhaseJudge;
  try {
    baselineJudge = await loadBaselineJudge(baselineRef, tmpPath);
  } finally {
    rmSync(tmpPath, { force: true });
  }
  const baselineLabels = replayCorpus(turns, baselineJudge);
  const diff = diffLabels(turns, baselineLabels, headLabels);

  const groups = new Map<string, ChangedTurn[]>();
  for (const change of diff.changed) {
    const key = `${change.from}→${change.to}`;
    const list = groups.get(key) ?? [];
    list.push(change);
    groups.set(key, list);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [key, list] of sortedGroups) {
    console.log(`== ${key} (${list.length}) ==`);
    for (const change of list) {
      const mark =
        change.direction === "improved" ? "+" : change.direction === "regressed" ? "-" : "=";
      console.log(
        `  ${mark} ${change.turn.runId}/${change.turn.scenarioId}#${change.turn.turnIndex} expected=${change.turn.expectedPhase}`,
      );
      console.log(`      ${truncate(change.turn.assistantMsg, maxText)}`);
    }
    console.log("");
  }

  console.log(
    `agreement: baseline(${baselineRef}) ${(diff.baselineAgreementRate * 100).toFixed(1)}% → head ${(diff.headAgreementRate * 100).toFixed(1)}%`,
  );
  console.log(
    `SUMMARY: ${diff.changed.length}/${diff.total} turns changed — ${diff.improved} improved, ${diff.regressed} regressed, ${diff.neutral} neutral (wrong both ways)`,
  );
};

// tsx で直接実行された時だけ CLI として動く(テストは集計関数だけを import する)。
if (process.argv[1]?.endsWith("replay-corpus.ts")) {
  await main();
}
