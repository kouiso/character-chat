#!/usr/bin/env tsx
/**
 * e2e 実行後に .work/quality-log.jsonl へスコアを追記する
 * 使い方: pnpm exec tsx script/e2e/append-quality-log.ts <manifest.json path>
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";

type RubricScore = {
  rawTotal?: number;
  eroticDensity?: number;
  [key: string]: unknown;
};

type ScenarioEntry = {
  scenarioId?: string;
  status?: string;
  terminationReason?: string | null;
  turns?: unknown[];
  rubricScore?: RubricScore | null;
};

type E2eManifest = {
  runId?: unknown;
  scenarios?: ScenarioEntry[];
};

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("Usage: append-quality-log.ts <manifest.json path>");
  process.exit(1);
}

const parseNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const parseString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const parseScenario = (s: ScenarioEntry) => {
  const rs = s.rubricScore ?? {};
  const score = parseNumberOrNull(rs.rawTotal ?? null);
  const aborted = s.terminationReason != null;
  const turns = Array.isArray(s.turns) ? s.turns.length : null;
  const eroticDensity = parseNumberOrNull(rs.eroticDensity ?? null);
  return {
    id: s.scenarioId ?? "unknown",
    score,
    aborted,
    turns,
    eroticDensity,
  };
};

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as E2eManifest;
const sha = execSync("git rev-parse --short HEAD").toString().trim();
const logPath = resolve(process.cwd(), ".work/quality-log.jsonl");

if (!existsSync(dirname(logPath))) {
  mkdirSync(dirname(logPath), { recursive: true });
}

const scenarios = (manifest.scenarios ?? []).map(parseScenario);
const completedScores = scenarios.filter((s) => !s.aborted && s.score !== null).map((s) => s.score as number);
const avgScore = completedScores.length > 0 ? completedScores.reduce((a, b) => a + b, 0) / completedScores.length : null;
const abortCount = scenarios.filter((s) => s.aborted).length;

const entry = {
  sha,
  timestamp: new Date().toISOString(),
  runId: parseString(manifest.runId, "unknown"),
  scenarios,
  avgScore: avgScore !== null ? Math.round(avgScore * 10) / 10 : null,
  abortCount,
};

appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
console.log(`[quality-log] appended entry for sha=${sha} to ${logPath}`);
console.log(JSON.stringify(entry, null, 2));
