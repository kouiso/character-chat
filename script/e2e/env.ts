import { randomBytes } from "node:crypto";
import path from "node:path";

// wrangler (8788) は HMR なしで dist/ を静的配信する。Vite (5173) は HMR WebSocket が
// ~60 秒でタイムアウトして full-reload を全クライアントに送信し、page.evaluate() の
// "Execution context was destroyed" でシナリオが一斉 abort する。
// macOS では localhost が ::1 (IPv6) に解決されることがあるが wrangler は 127.0.0.1 のみ
// リッスンするため、ECONNREFUSED ::1:8788 を防ぐために IPv4 アドレスを明示指定する。
const DEFAULT_BASE_URL = "http://127.0.0.1:8788";
const DEFAULT_CDP_PORT = 9222;
const DEFAULT_MAX_TABS = 3;
const DEFAULT_SCENARIO_COOLDOWN_MS = 0;

export type E2EEnv = {
  runId: string;
  userEmail: string;
  baseUrl: string;
  cdpPort: number;
  maxTabs: number;
  scenarioCooldownMs: number;
  artifactRoot: string;
  devOrigin: string;
  workerOrigin: string;
  resultsRoot: string;
};
export type E2eEnv = E2EEnv;

type E2EEnvOverrides = Partial<E2EEnv>;

const pad = (value: number): string => String(value).padStart(2, "0");

const formatTimestamp = (date: Date): string =>
  [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("") +
  "-" +
  [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");

const generateRunId = (): string =>
  `run-${formatTimestamp(new Date())}-${randomBytes(2).toString("hex")}`;

const parseInteger = (rawValue: string | undefined, fallback: number, label: string): number => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} は正の整数で指定してください: ${rawValue}`);
  }
  return value;
};

const parseNonNegativeInteger = (
  rawValue: string | undefined,
  fallback: number,
  label: string,
): number => {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} は 0 以上の整数で指定してください: ${rawValue}`);
  }
  return value;
};

const capMaxTabs = (value: number): number => Math.min(value, DEFAULT_MAX_TABS);

const defaultArtifactRoot = (runId: string): string =>
  path.join(".work", "e2e-results", "runs", runId);

export const loadE2EEnv = (): E2EEnv => {
  const runId = process.env.E2E_RUN_ID?.trim() || generateRunId();
  // ローカル wrangler dev の getUserEmail() は常に "sukererion@gmail.com" を返す。
  // seed.ts も同じ user_id で character を作成するため、E2E も同じ user を共有しないと
  // GET /api/characters が空になってシナリオが character-not-found で失敗する。
  const userEmail = process.env.E2E_USER_EMAIL?.trim() || "sukererion@gmail.com";
  const baseUrl = process.env.E2E_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const cdpPort = parseInteger(process.env.E2E_CDP_PORT, DEFAULT_CDP_PORT, "E2E_CDP_PORT");
  const maxTabs = capMaxTabs(
    parseInteger(process.env.E2E_MAX_TABS, DEFAULT_MAX_TABS, "E2E_MAX_TABS"),
  );
  const scenarioCooldownMs = parseNonNegativeInteger(
    process.env.E2E_SCENARIO_COOLDOWN_MS,
    DEFAULT_SCENARIO_COOLDOWN_MS,
    "E2E_SCENARIO_COOLDOWN_MS",
  );
  const artifactRoot = process.env.E2E_ARTIFACT_ROOT?.trim() || defaultArtifactRoot(runId);

  if (!userEmail.includes("@")) {
    throw new Error(`E2E_USER_EMAIL が不正です: ${userEmail}`);
  }

  return {
    runId,
    userEmail,
    baseUrl,
    cdpPort,
    maxTabs,
    scenarioCooldownMs,
    artifactRoot,
    devOrigin: baseUrl,
    workerOrigin: process.env.E2E_WORKER_ORIGIN?.trim() || baseUrl,
    resultsRoot: path.dirname(path.dirname(artifactRoot)),
  };
};

export const resolveEnv = (overrides: E2EEnvOverrides = {}): E2EEnv => {
  const loaded = loadE2EEnv();
  const runId = overrides.runId ?? loaded.runId;
  const artifactRoot =
    overrides.artifactRoot ??
    (overrides.runId && overrides.runId !== loaded.runId
      ? defaultArtifactRoot(runId)
      : loaded.artifactRoot);
  return {
    ...loaded,
    ...overrides,
    runId,
    maxTabs: capMaxTabs(overrides.maxTabs ?? loaded.maxTabs),
    scenarioCooldownMs: overrides.scenarioCooldownMs ?? loaded.scenarioCooldownMs,
    artifactRoot,
    resultsRoot: overrides.resultsRoot ?? path.dirname(path.dirname(artifactRoot)),
    devOrigin: overrides.devOrigin ?? overrides.baseUrl ?? loaded.devOrigin,
    workerOrigin:
      overrides.workerOrigin ??
      process.env.E2E_WORKER_ORIGIN?.trim() ??
      overrides.baseUrl ??
      loaded.workerOrigin,
  };
};
