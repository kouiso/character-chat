import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GATE_SCENARIOS,
  GATE_THRESHOLDS,
  allGatesPass,
  buildScenarioRunRecord,
  evaluateGates,
} from "./gate-metrics";
import { getPaths, loadManifest } from "./manifest";

import type { GateVerdict, ScenarioRunRecord } from "./gate-metrics";
import type { RunManifest } from "./types";

const USAGE = `Usage:
  tsx script/e2e/gate-899.ts                       # S4,S6,S7,S8 を各3回実走して #899 ゲートを判定
  tsx script/e2e/gate-899.ts --from-runs=a,b,c     # 既存 runId の manifest だけで再集計（実走なし）
  tsx script/e2e/gate-899.ts --results-root=DIR    # 結果ルートを差し替える
  tsx script/e2e/gate-899.ts --out=DIR             # 集計成果物の出力先`;

export type GateCliOptions = {
  fromRuns: string[] | null;
  resultsRoot: string;
  outDir: string | null;
  help: boolean;
};

const DEFAULT_RESULTS_ROOT = path.join(".work", "e2e-results");

export const parseGateCliArgs = (argv: string[]): GateCliOptions => {
  const options: GateCliOptions = {
    fromRuns: null,
    resultsRoot: DEFAULT_RESULTS_ROOT,
    outDir: null,
    help: false,
  };

  for (const arg of argv) {
    // pnpm run は引数区切りの "--" をそのまま子プロセスへ渡すため無視する。
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--from-runs=")) {
      const values = arg
        .slice("--from-runs=".length)
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (values.length === 0) {
        throw new Error("--from-runs は 1 件以上の runId を指定してください");
      }
      // 同じ runId を並べると同一 manifest を複数回読み、物理1回の実行が
      // 複数 run 分のカバレッジとして通ってまう。
      const duplicated = values.filter((value, index) => values.indexOf(value) !== index);
      if (duplicated.length > 0) {
        const shown = [...new Set(duplicated)].join(", ");
        throw new Error(`--from-runs に重複した runId があります: ${shown}`);
      }
      options.fromRuns = values;
      continue;
    }
    if (arg.startsWith("--results-root=")) {
      options.resultsRoot = arg.slice("--results-root=".length);
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.outDir = arg.slice("--out=".length);
      continue;
    }
    throw new Error(`未知の引数です: ${arg}\n${USAGE}`);
  }

  return options;
};

export const collectRecordsFromManifests = (
  manifests: readonly { runIndex: number; manifest: RunManifest }[],
): ScenarioRunRecord[] => {
  const gateSet = new Set<string>(GATE_SCENARIOS);
  const records: ScenarioRunRecord[] = [];

  for (const entry of manifests) {
    for (const scenario of entry.manifest.scenarios) {
      if (!gateSet.has(scenario.scenarioId)) continue;
      records.push(
        buildScenarioRunRecord(scenario, {
          runIndex: entry.runIndex,
          runId: entry.manifest.runId,
        }),
      );
    }
  }

  return records;
};

export const renderGateReport = (verdicts: readonly GateVerdict[]): string => {
  const header = "| gate | 結果 | 実測 | 基準 | 分母 | margin |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const rows = verdicts.map(
    (verdict) =>
      `| ${verdict.gate} | ${verdict.pass ? "PASS" : "FAIL"} | ${verdict.observed} | ${verdict.threshold} | ${verdict.denominator} | ${verdict.margin} |`,
  );
  return [header, divider, ...rows].join("\n");
};

export const renderPhaseTimeline = (records: readonly ScenarioRunRecord[]): string =>
  records
    .map((record) => {
      const lines = record.phaseTimeline.map(
        (entry) =>
          `  t${String(entry.turnIndex).padStart(2, "0")} expected=${entry.expectedPhase} detected=${entry.detectedPhase ?? "null"} aligned=${entry.aligned ? "y" : "n"} ttfb=${entry.firstTokenMs ?? "n/a"} total=${entry.wallClockMs}`,
      );
      return [`${record.scenarioId} run${record.runIndex} (${record.runId})`, ...lines].join("\n");
    })
    .join("\n\n");

const runOnce = (runId: string, resultsRoot: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join("node_modules", "tsx", "dist", "cli.mjs"),
        path.join("script", "e2e", "run.ts"),
        `--scenarios=${GATE_SCENARIOS.join(",")}`,
        `--runId=${runId}`,
      ],
      {
        stdio: "inherit",
        // run.ts に --results-root は無く、出力先は E2E_ARTIFACT_ROOT だけで決まる。
        // さらに resolveEnv は --runId が E2E_RUN_ID と食い違うと artifactRoot を
        // 既定へ戻すため、両方を揃えて渡さんと親子で参照先がズレる。
        env: {
          ...process.env,
          E2E_RUN_ID: runId,
          E2E_ARTIFACT_ROOT: path.join(resultsRoot, "runs", runId),
        },
      },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });

const main = async (): Promise<void> => {
  const options = parseGateCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const gateId = `gate899-${new Date().toISOString().replace(/[:.]/gu, "-")}`;
  const runIds: string[] = options.fromRuns ?? [];

  if (options.fromRuns === null) {
    for (let runIndex = 1; runIndex <= GATE_THRESHOLDS.runsPerScenario; runIndex += 1) {
      const runId = `${gateId}-r${runIndex}`;
      console.error(`[gate899] run ${runIndex}/${GATE_THRESHOLDS.runsPerScenario} runId=${runId}`);
      const code = await runOnce(runId, options.resultsRoot);
      // 途中失敗しても残りを回す。全 run の実測が揃わないと分母が確定しないため。
      if (code !== 0) console.error(`[gate899] run ${runIndex} exited ${code}`);
      runIds.push(runId);
    }
  }

  const manifests: { runIndex: number; manifest: RunManifest }[] = [];
  // preflight で落ちた run は manifest を残さん。ここで throw すると3回実走した後に
  // results.json もレポートも残らんので、欠損として記録して集計は続ける。
  const missingRuns: { runId: string; reason: string }[] = [];
  for (const [index, runId] of runIds.entries()) {
    const { manifestPath } = getPaths(options.resultsRoot, runId);
    try {
      manifests.push({ runIndex: index + 1, manifest: await loadManifest(manifestPath) });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[gate899] manifest を読めません runId=${runId}: ${reason}`);
      missingRuns.push({ runId, reason });
    }
  }

  const records = collectRecordsFromManifests(manifests);
  const verdicts = evaluateGates(records);
  const passed = allGatesPass(verdicts) && missingRuns.length === 0;

  const outDir = options.outDir ?? path.join(options.resultsRoot, "gate-899", gateId);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "results.json"),
    `${JSON.stringify({ gateId, runIds, missingRuns, passed, verdicts, records }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(outDir, "phase-timeline.txt"), `${renderPhaseTimeline(records)}\n`, "utf8");
  const missingSection =
    missingRuns.length === 0
      ? ""
      : `\nmanifest 欠損: ${missingRuns.map((entry) => entry.runId).join(", ")}\n`;
  await writeFile(
    path.join(outDir, "report.md"),
    `# #899 gate report — ${gateId}\n\nruns: ${runIds.join(", ")}\n${missingSection}\n${renderGateReport(verdicts)}\n`,
    "utf8",
  );

  console.log(renderGateReport(verdicts));
  if (missingRuns.length > 0) {
    console.error(`manifest 欠損: ${missingRuns.map((entry) => entry.runId).join(", ")}`);
  }
  console.log(`\nartifacts: ${outDir}`);
  process.exitCode = passed ? 0 : 1;
};

const isDirectRun =
  process.argv[1] !== undefined && process.argv[1].includes(path.join("script", "e2e", "gate-899"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
