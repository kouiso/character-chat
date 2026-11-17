#!/usr/bin/env tsx
// RIT-99 記憶想起ベンチ。古い近似版（バイグラム照合）とは別物 — 本番の抜き出し・
// 埋め込み・検索・順位づけ・あらすじ・記憶ジョブを全部通して、植えた 5 つの事実が
// +50/+200 で帰ってくるかを測る。
//
// 使い方:
//   tsx src/memory-recall-check.ts --mode fake [--arms retrieval,cheat,none] [--out path]
//       [--keep-transcript] [--sabotage retrieval-off] [--call-limit n] [--usd-limit n]
//   --mode real は OPENROUTER_API_KEY / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN が要る。
//
// 終了コード: 0=正常, 3=健全性ゲート失敗（valid:false）, 4=鍵不足, 5=呼び出し/料金上限,
// 1=その他の失敗。stdout には JSON 報告だけを出す（本文は FR-11 で禁止）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { applyLocalMigrations } from "@v2/cf/migrate";
import { createModelChain, type ModelCandidate, type ModelEnv, type TurnModel } from "@v2/engine";

import { createFakeAi, FAKE_EMBEDDING_MODEL } from "./memory-bench/fake-ai";
import { createFakeChat } from "./memory-bench/fake-chat";
import { createFakeExtractor } from "./memory-bench/fake-extractor";
import {
  countEmbeddingAi,
  createCallBudget,
  CountedChatModel,
  gitSha,
  runArm,
  type PriceTable,
} from "./memory-bench/harness";
import { buildScenario } from "./memory-bench/recall-scenario";
import {
  memoryRecallReportSchema,
  type ArmName,
  type MemoryRecallReport,
} from "./memory-bench/report";
import { createLocalVectorIndex } from "./memory-bench/vector-index";
import { createRestAi } from "./memory-bench/workers-ai-rest";

const ARM_ORDER: ArmName[] = ["retrieval", "cheat", "none"];
// 未解決事項の既定値（issue コメントに記録）: 呼び出し上限 retrieval 500・cheat/none 250、
// 料金上限 $2/$1/$1、会話 10 秒/ターン・抜き出し 3 秒。
const CALL_LIMITS: Record<ArmName, number> = { retrieval: 500, cheat: 250, none: 250 };
const USD_LIMITS: Record<ArmName, number> = { retrieval: 2, cheat: 1, none: 1 };

const REAL_MODE_KEYS = [
  "OPENROUTER_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

type CliArgs = {
  mode: "fake" | "real";
  arms: ArmName[];
  out?: string;
  keepTranscript: boolean;
  sabotage: "retrieval-off" | null;
  callLimit?: number;
  usdLimit?: number;
  model?: string;
  providerOnly?: string;
};

const VALUE_FLAGS: Record<string, (args: CliArgs, value: string) => void> = {
  "--mode": (args, value) => {
    args.mode = value as CliArgs["mode"];
  },
  "--out": (args, value) => {
    args.out = value;
  },
  "--arms": (args, value) => {
    args.arms = value.split(",").map((name) => name.trim()) as ArmName[];
  },
  "--sabotage": (args, value) => {
    args.sabotage = value as CliArgs["sabotage"];
  },
  "--call-limit": (args, value) => {
    args.callLimit = Number(value);
  },
  "--usd-limit": (args, value) => {
    args.usdLimit = Number(value);
  },
  "--model": (args, value) => {
    args.model = value;
  },
  "--provider-only": (args, value) => {
    args.providerOnly = value;
  },
};

const validateArgs = (args: CliArgs): void => {
  if (args.mode !== "fake" && args.mode !== "real") throw new Error(`unknown mode: ${args.mode}`);
  if (args.sabotage !== null && args.sabotage !== "retrieval-off")
    throw new Error(`unknown sabotage: ${args.sabotage}`);
  for (const arm of args.arms) {
    if (!ARM_ORDER.includes(arm)) throw new Error(`unknown arm: ${arm}`);
  }
  // 常に正規の順序で回す（報告と破壊試験の再現性のため）。
  args.arms = ARM_ORDER.filter((arm) => args.arms.includes(arm));
  if (args.arms.length === 0) throw new Error("no arms selected");
};

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = {
    mode: "fake",
    arms: [...ARM_ORDER],
    keepTranscript: false,
    sabotage: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--keep-transcript") {
      args.keepTranscript = true;
      continue;
    }
    const setter = VALUE_FLAGS[arg];
    if (!setter) throw new Error(`unknown flag: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    setter(args, value);
    i += 1;
  }
  validateArgs(args);
  return args;
};

// OpenRouter の価格表（USD/token）。取れん時は推定なしで進める。
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

// fake モードの時間は注入した進行時計で測る（同じ呼び出し列なら同じ ms に戻る）。
const createFakeClock = (): (() => number) => {
  let tick = 1_700_000_000_000;
  return () => (tick += 7);
};

const iso = (ms: number): string => new Date(ms).toISOString();

// モードごとの部品。fake は鍵不要・決定論、real は OpenRouter + Workers AI REST。
type ModeParts = {
  makeChatModel: () => { model: ModelCandidate["model"]; candidates?: ModelCandidate[] };
  makeExtractionModel: () => BaseChatModel;
  ai: Pick<Ai, "run">;
  models: MemoryRecallReport["models"];
  prices: PriceTable;
  usdKnown: boolean;
};

const fakeParts = (scenario: ReturnType<typeof buildScenario>): ModeParts => ({
  makeChatModel: () => ({
    model: createFakeChat({ questions: scenario.questions, summary: "blank" }),
  }),
  makeExtractionModel: () => createFakeExtractor(scenario.extractorTable),
  ai: createFakeAi(),
  models: { chat: "fake-judge", extraction: "fake-table", embedding: FAKE_EMBEDDING_MODEL },
  prices: {},
  usdKnown: false,
});

const realParts = async (
  args: CliArgs,
  env: Record<string, string | undefined>,
): Promise<ModeParts> => {
  const modelEnv: ModelEnv = { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY };
  if (args.model || args.providerOnly) {
    modelEnv.V2_MODEL_CHAIN = JSON.stringify([
      { model: args.model, ...(args.providerOnly ? { providerOnly: [args.providerOnly] } : {}) },
    ]);
  }
  const chain = createModelChain(modelEnv);
  // 会話・抜き出し・あらすじは同じモデル（本番の抜き出しも列の先頭を使う）。
  const extractionEnv: ModelEnv = { ...modelEnv };
  const prices = await fetchOpenRouterPrices(env.OPENROUTER_API_KEY ?? "");
  return {
    makeChatModel: () => {
      const counted = chain.map((candidate) => ({
        name: candidate.name,
        model: candidate.model as unknown as TurnModel,
      }));
      return { model: counted[0].model, candidates: counted };
    },
    makeExtractionModel: () => createModelChain(extractionEnv)[0].model,
    ai: createRestAi({
      accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
      apiToken: env.CLOUDFLARE_API_TOKEN ?? "",
    }),
    models: { chat: chain[0].name, extraction: chain[0].name, embedding: "@cf/baai/bge-m3" },
    prices,
    usdKnown: Object.keys(prices).length > 0,
  };
};

type ArmTotals = {
  chat: number;
  extraction: number;
  summary: number;
  embedding: number;
  extractionFailures: number;
  embeddingFailures: number;
};

type RunAllResult = {
  arms: MemoryRecallReport["arms"];
  totals: ArmTotals;
  usdTotal: number;
  aborted: MemoryRecallReport["aborted"];
  transportFailedAsks: number;
  transcripts: { arm: ArmName; records: { turn: number; user: string; assistant: string }[] }[];
};

// 腕は D1・索引・予算・モデルが全部別物なので並列で回す（NFR-1 の 120 秒）。
// 報告の値は腕ごとの計測だけから出るので、同時実行でも NFR-2 の決定論は崩れん。
const runOneArm = async (
  args: CliArgs,
  scenario: ReturnType<typeof buildScenario>,
  template: string,
  parts: ModeParts,
  arm: ArmName,
): Promise<{
  arm: ArmName;
  budget: ReturnType<typeof createCallBudget>;
  result: Awaited<ReturnType<typeof runArm>>;
  records: { turn: number; user: string; assistant: string }[];
}> => {
  const budget = createCallBudget({
    limit: args.callLimit ?? CALL_LIMITS[arm],
    usdLimit: args.usdLimit ?? USD_LIMITS[arm],
    usdKnown: parts.usdKnown,
  });
  const vectorIndex = createLocalVectorIndex();
  const chat = parts.makeChatModel();
  const countedCandidates = chat.candidates?.map((candidate) => ({
    name: candidate.name,
    model: new CountedChatModel(candidate.model, budget, {
      prices: parts.prices,
      modelName: candidate.name,
    }),
  }));
  const records: { turn: number; user: string; assistant: string }[] = [];
  const result = await runArm({
    scenario,
    arm,
    persistTemplate: template,
    model: new CountedChatModel(chat.model, budget, {
      prices: parts.prices,
      modelName: parts.models.chat,
    }),
    candidates: countedCandidates,
    extractionModel: new CountedChatModel(
      parts.makeExtractionModel() as unknown as TurnModel,
      budget,
      {
        fixedKind: "extraction",
        invokeTimeoutMs: args.mode === "real" ? 3_000 : undefined,
        prices: parts.prices,
        modelName: parts.models.extraction,
      },
    ),
    bindings: {
      V2_RAG_ENABLED: "1",
      AI: countEmbeddingAi(parts.ai, budget),
      MEMORY_INDEX: vectorIndex,
    },
    vectorIndex,
    budget,
    sabotage: args.sabotage,
    collectTranscript: (record) => records.push(record),
    now: args.mode === "fake" ? createFakeClock() : Date.now,
    sleep: args.mode === "fake" ? () => Promise.resolve() : undefined,
  });
  return { arm, budget, result, records };
};

const runAllArms = async (
  args: CliArgs,
  scenario: ReturnType<typeof buildScenario>,
  template: string,
  parts: ModeParts,
): Promise<RunAllResult> => {
  const out: RunAllResult = {
    arms: {},
    totals: {
      chat: 0,
      extraction: 0,
      summary: 0,
      embedding: 0,
      extractionFailures: 0,
      embeddingFailures: 0,
    },
    usdTotal: 0,
    aborted: null,
    transportFailedAsks: 0,
    transcripts: [],
  };
  const results = await Promise.all(
    args.arms.map((arm) => runOneArm(args, scenario, template, parts, arm)),
  );
  // 集計は常に正規の腕順（Promise.all は投げた順を保つ）。
  for (const { arm, budget, result, records } of results) {
    out.arms[arm] = result.arm;
    out.totals.chat += budget.chat;
    out.totals.extraction += budget.extraction;
    out.totals.summary += budget.summary;
    out.totals.embedding += budget.embedding;
    out.totals.extractionFailures += budget.extractionFailures;
    out.totals.embeddingFailures += budget.embeddingFailures;
    out.usdTotal += budget.usd;
    out.transportFailedAsks += result.transportFailedAsks;
    if (result.aborted && out.aborted === null) out.aborted = result.aborted;
    out.transcripts.push({ arm, records });
    await result.cleanup();
  }
  return out;
};

// 健全性ゲート（FR-6）。回した腕だけを採点する。
const fakeGateFailures = (arms: MemoryRecallReport["arms"]): string[] => {
  const failures: string[] = [];
  if (arms.cheat && (arms.cheat.correct !== 10 || arms.cheat.asked !== 10))
    failures.push(`cheat:${arms.cheat.correct}/${arms.cheat.asked}`);
  if (arms.none && arms.none.correct !== 0) failures.push(`none:${arms.none.correct}/10`);
  return failures;
};

const realGateFailures = (arms: MemoryRecallReport["arms"]): string[] => {
  const failures: string[] = [];
  if (arms.cheat && arms.cheat.ratio < 0.9) failures.push(`cheat:${arms.cheat.ratio}`);
  if (arms.none && arms.none.ratio > 0.1) failures.push(`none:${arms.none.ratio}`);
  return failures;
};

const gateFailures = (mode: CliArgs["mode"], arms: MemoryRecallReport["arms"]): string[] =>
  mode === "fake" ? fakeGateFailures(arms) : realGateFailures(arms);

const writeTranscripts = (transcripts: RunAllResult["transcripts"]): void => {
  const dir = path.join(REPO_WORK, "memory-bench", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  for (const { arm, records } of transcripts) {
    writeFileSync(path.join(dir, `transcript-${arm}.json`), JSON.stringify(records, null, 2));
  }
};

const checkRealKeys = (mode: CliArgs["mode"]): number => {
  if (mode !== "real") return 0;
  const missing = REAL_MODE_KEYS.filter((key) => !process.env[key]);
  for (const key of missing) process.stderr.write(`missing: ${key}\n`);
  return missing.length > 0 ? 4 : 0;
};

const buildReport = (
  args: CliArgs,
  parts: ModeParts,
  run: RunAllResult,
  startedAt: number,
  invalidReason: string | null,
): MemoryRecallReport => ({
  kind: "memory-recall",
  schemaVersion: 1,
  startedAt: iso(startedAt),
  finishedAt: iso(Date.now()),
  gitSha: gitSha(),
  mode: args.mode,
  models: parts.models,
  arms: run.arms,
  valid: invalidReason === null,
  invalidReason,
  calls: {
    ...run.totals,
    extractionFailures: run.totals.extractionFailures || undefined,
    embeddingFailures: run.totals.embeddingFailures || undefined,
  },
  estimatedUsd: args.mode === "real" ? (parts.usdKnown ? run.usdTotal : null) : null,
  aborted: run.aborted,
  sabotage: args.sabotage,
});

const emitReport = (report: MemoryRecallReport, out: string | undefined): void => {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(text);
  if (!out) return;
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(path.resolve(out), text);
};

const main = async (): Promise<number> => {
  const args = parseArgs(process.argv.slice(2));
  const keyCode = checkRealKeys(args.mode);
  if (keyCode !== 0) return keyCode;

  const scenario = buildScenario();
  const template = mkdtempSync(path.join(tmpdir(), "memory-bench-template-"));
  applyLocalMigrations({ persistRoot: template, quiet: true });

  const parts =
    args.mode === "fake"
      ? fakeParts(scenario)
      : await realParts(args, process.env as Record<string, string | undefined>);

  const startedAt = Date.now();
  const run = await runAllArms(args, scenario, template, parts);
  rmSync(template, { recursive: true, force: true });

  const gates = gateFailures(args.mode, run.arms);
  const invalidReason =
    gates.length > 0
      ? `gate:${gates.join(",")}`
      : run.transportFailedAsks >= 3
        ? "transport"
        : null;

  const report = buildReport(args, parts, run, startedAt, invalidReason);
  memoryRecallReportSchema.parse(report);
  if (args.keepTranscript) writeTranscripts(run.transcripts);
  emitReport(report, args.out);

  if (run.aborted) return 5;
  return invalidReason === null ? 0 : 3;
};

const REPO_WORK = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.work");

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // 失敗理由の中身（会話本文・プロンプト）を出さんよう、種類名だけを出す。
    const name = error instanceof Error ? error.name : "unknown";
    process.stderr.write(`error:${name}\n`);
    process.exitCode = 1;
  });
