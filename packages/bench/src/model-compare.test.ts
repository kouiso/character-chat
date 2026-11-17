// RIT-96 モデル比較の単体試験。想起試験台・台本実行・単価取得は全部差し替える
// （ネットへ出ない・実モデルを呼ばない・手元 D1 も立てない）。
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { modelCompareReportSchema } from "./memory-bench/report";
import {
  COMPARE_MODELS,
  envForModel,
  runModelCompare,
  type ModelCompareDeps,
  type ModelCompareOptions,
  type ModelSpec,
  type PriceTable,
  type RecallRunOutcome,
} from "./model-compare";
import { writeTurn, type RunContext, type TurnRecord } from "./script-run";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { V2Db } from "@v2/db";

const OK_BODY =
  "<response><action>微笑む</action><dialogue>……うん、分かった。また明日ね。</dialogue></response>";
const REFUSAL_BODY = "申し訳ありませんが、その内容にはお応えできません。";

const record = (label: string, turn: number, text: string): TurnRecord => ({
  character: label,
  turn,
  intent: "conversation",
  servedPhase: "conversation",
  model: "fake",
  warningLevel: false,
  dropped: 0,
  regenerated: 0,
  extended: 0,
  visibleChars: text.length,
  innerChars: 0,
  mechanicsPhase: "conversation",
  preExtendVisibleChars: null,
  preExtendBodyChars: 0,
  latencyMs: 1_000,
  error: null,
  ending: "ok",
  userText: "u",
  text,
  chunks: [],
  droppedEvents: [],
});

const records = (label: string, count: number, text = OK_BODY): TurnRecord[] =>
  Array.from({ length: count }, (_, i) => record(label, i + 1, text));

type Calls = {
  recall: ModelSpec[];
  script: { label: string; model: string; ctx: RunContext }[];
  logs: string[];
  errs: string[];
};

type Fake = { deps: ModelCompareDeps; calls: Calls };

const recallOk = (ratio: number): RecallRunOutcome => ({
  ok: true,
  correct: Math.round(ratio * 10),
  asked: 10,
  ratio,
  byDistance: {
    "50": { correct: Math.round(ratio * 5), asked: 5 },
    "200": { correct: Math.round(ratio * 5), asked: 5 },
  },
  firstChunkMs: [100, 200, 300],
  totalMs: [1_000, 2_000, 3_000],
  estimatedUsd: 0.5,
});

const fakeDeps = (overrides: Partial<ModelCompareDeps> = {}): Fake => {
  const calls: Calls = { recall: [], script: [], logs: [], errs: [] };
  const deps: ModelCompareDeps = {
    env: {
      OPENROUTER_API_KEY: "key",
      CLOUDFLARE_ACCOUNT_ID: "acct",
      CLOUDFLARE_API_TOKEN: "token",
      V2_MODEL: "pinned/override",
      V2_MODEL_CHAIN: "ignored",
    },
    fetchPrices: async (): Promise<PriceTable> => ({}),
    runRecall: async (spec) => {
      calls.recall.push(spec);
      return recallOk(0.6);
    },
    runScript: async (ctx, _db, _model, entry) => {
      calls.script.push({ label: entry.label, model: entry.id, ctx });
      return records(entry.label, entry.script.length);
    },
    prepareScriptDb: async () => ({ db: {} as V2Db, dispose: async () => {} }),
    checkScriptCharacters: async () => {},
    makeScriptModel: () => ({}) as BaseChatModel,
    now: () => 1_700_000_000_000,
    gitSha: () => "abc1234",
    log: (line) => calls.logs.push(line),
    err: (line) => calls.errs.push(line),
    ...overrides,
  };
  return { deps, calls };
};

const options = (dir: string, extra: Partial<ModelCompareOptions> = {}): ModelCompareOptions => ({
  models: COMPARE_MODELS,
  recallRuns: 2,
  scriptTurns: 10,
  deadlineMs: 8 * 60 * 60 * 1000,
  usdCap: 10,
  dryRun: false,
  outPath: join(dir, "report.json"),
  docPath: join(dir, "model-compare.md"),
  sourceCommand: "pnpm --filter @v2/bench model-compare -- --out .work/x.json",
  ...extra,
});

describe("model-compare", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "model-compare-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("4 モデルを順に回し、想起を 2 回・台本を 1 回ずつ呼ぶ（FR-1・FR-2）", async () => {
    const { deps, calls } = fakeDeps();
    const { code, report } = await runModelCompare(deps, options(dir));
    expect(code).toBe(0);
    // 呼ばれ方: モデルごとに [recall, recall, Sakura, Downer]。並行せん。
    expect(calls.recall.map((spec) => spec.role)).toEqual([
      "default",
      "default",
      "escape1",
      "escape1",
      "escape2",
      "escape2",
      "previous-default",
      "previous-default",
    ]);
    expect(calls.script.map((c) => c.label)).toEqual([
      "Sakura",
      "Downer",
      "Sakura",
      "Downer",
      "Sakura",
      "Downer",
      "Sakura",
      "Downer",
    ]);
    // recall には providerOnly 付きの spec がそのまま渡る（escape1 は Venice 固定）。
    expect(calls.recall[2]).toMatchObject({
      model: "deepseek/deepseek-v4.1-flash",
      providerOnly: ["Venice"],
    });
    // 台本は transcript を残さん指定で回る（FR-6）。
    for (const c of calls.script) expect(c.ctx.writeTranscript).toBe(false);
    expect(report?.rows).toHaveLength(4);
  });

  it("拒否の文を返すモデルで拒否 n/送ったターン数が数えられる（FR-3）", async () => {
    const { deps, calls } = fakeDeps();
    deps.runScript = async (_ctx, _db, _m, entry) => {
      calls.script.push({ label: entry.label, model: entry.id, ctx: _ctx });
      return records(entry.label, entry.script.length, REFUSAL_BODY);
    };
    const { report } = await runModelCompare(deps, options(dir));
    for (const row of report?.rows ?? []) {
      expect(row.refusal).toEqual({
        refused: 20,
        empty: 0,
        turns: 20,
        stoppedAfterTurn: { Sakura: null, Downer: null },
      });
    }
  });

  it("7 ターン目で止まる台本で分母が 17・stoppedAfterTurn が 7（FR-3）", async () => {
    const { deps } = fakeDeps();
    deps.runScript = async (_ctx, _db, _m, entry) =>
      records(entry.label, entry.label === "Sakura" ? 7 : 10);
    const { report } = await runModelCompare(deps, options(dir));
    for (const row of report?.rows ?? []) {
      expect(row.refusal?.turns).toBe(17);
      expect(row.refusal?.stoppedAfterTurn).toEqual({ Sakura: 7, Downer: null });
    }
  });

  it("キャラの行が無い時 unavailable・character_missing（FR-3）", async () => {
    const { deps, calls } = fakeDeps({
      checkScriptCharacters: async () => {
        throw new Error("行が無い（pnpm db:migrate:local && pnpm db:seed）");
      },
    });
    const { report } = await runModelCompare(deps, options(dir));
    for (const row of report?.rows ?? []) {
      expect(row.status).toBe("unavailable");
      expect(row.reason).toBe("character_missing");
    }
    // キャラが読めんモデルでは想起も台本も呼ばん（金を使わん）。
    expect(calls.recall).toHaveLength(0);
    expect(calls.script).toHaveLength(0);
  });

  it("空の返事は empty に数える（FR-3）", async () => {
    const { deps } = fakeDeps();
    deps.runScript = async (_ctx, _db, _m, entry) => records(entry.label, entry.script.length, "");
    const { report } = await runModelCompare(deps, options(dir));
    for (const row of report?.rows ?? []) {
      expect(row.refusal?.empty).toBe(20);
      // 空は拒否と別カウント（hardRefusalDetect は短文を拒否と見なすので二重計上を防ぐ）。
      expect(row.refusal?.refused).toBe(0);
    }
  });

  it("報告が ModelCompareReport の zod を通る（FR-4）", async () => {
    const { deps } = fakeDeps();
    const { report } = await runModelCompare(deps, options(dir));
    expect(() => modelCompareReportSchema.parse(report)).not.toThrow();
  });

  it("揺れ＝|1 回目−2 回目|・平均は 2 回の平均（FR-4）", async () => {
    const { deps, calls } = fakeDeps();
    const ratios = [0.6, 0.9];
    deps.runRecall = async (spec) => {
      calls.recall.push(spec);
      return recallOk(ratios[calls.recall.length % 2]);
    };
    const { report } = await runModelCompare(deps, options(dir));
    for (const row of report?.rows ?? []) {
      expect(row.recall?.spread).toBeCloseTo(0.3);
      expect(row.recall?.mean).toBeCloseTo(0.75);
      expect(row.recall?.runs.map((run) => run.ratio)).toEqual([0.9, 0.6]);
    }
  });

  it("既定が揺れを超えて下回ると defaultBehind に入る（FR-5）", async () => {
    const { deps } = fakeDeps();
    const ratios: Record<string, number[]> = {
      default: [0.6, 0.6],
      escape1: [0.8, 0.9],
      escape2: [0.5, 0.5],
      "previous-default": [0.4, 0.4],
    };
    const seen: Record<string, number> = {};
    deps.runRecall = async (spec) => {
      seen[spec.role] = (seen[spec.role] ?? 0) + 1;
      return recallOk(ratios[spec.role][seen[spec.role] % 2]);
    };
    const { report } = await runModelCompare(deps, options(dir));
    // 差 0.25 ＞ max(0, 0.1) なので逃げ道1だけ入る。
    expect(report?.defaultBehind).toEqual(["deepseek/deepseek-v4.1-flash [Venice]"]);
    const doc = readFileSync(join(dir, "model-compare.md"), "utf8");
    expect(doc).toContain(
      "既定が記憶の正答で下回った: deepseek/deepseek-v4.1-flash \\[Venice\\]（差 0.25、揺れ 0.1）",
    );
  });

  it("揺れの内なら defaultBehind に入らん（FR-5）", async () => {
    const { deps } = fakeDeps();
    const ratios: Record<string, number[]> = {
      default: [0.5, 0.8],
      escape1: [0.5, 0.5],
      escape2: [0.8, 0.9],
      "previous-default": [0.9, 0.9],
    };
    const seen: Record<string, number> = {};
    deps.runRecall = async (spec) => {
      seen[spec.role] = (seen[spec.role] ?? 0) + 1;
      return recallOk(ratios[spec.role][seen[spec.role] % 2]);
    };
    const { report } = await runModelCompare(deps, options(dir));
    // 差 0.2 ≦ max(0.3, 0.1) なので入らん（旧既定はそも比べん）。
    expect(report?.defaultBehind).toEqual([]);
  });

  it("返事の本文が報告・doc・--out に出ない（SENTINEL、FR-6）", async () => {
    const { deps } = fakeDeps();
    deps.runScript = async (_ctx, _db, _m, entry) =>
      records(entry.label, entry.script.length, "SENTINEL-BODY-XYZ");
    const { report } = await runModelCompare(deps, options(dir));
    const json = JSON.stringify(report);
    const doc = readFileSync(join(dir, "model-compare.md"), "utf8");
    const out = readFileSync(join(dir, "report.json"), "utf8");
    for (const text of [json, doc, out]) expect(text).not.toContain("SENTINEL-BODY-XYZ");
  });

  it("writeTranscript:false の writeTurn はファイルを増やさん（FR-6）", () => {
    const ctx: RunContext = {
      arm: "model-compare",
      run: "compare",
      runId: "t1",
      outDir: dir,
      qualityLines: [],
      writeTranscript: false,
    };
    const before = readdirSync(dir).length;
    writeTurn(ctx, record("Sakura", 1, "SECRET"));
    expect(readdirSync(dir).length).toBe(before);
    // 対照: true なら従来どおり書く。
    writeTurn({ ...ctx, writeTranscript: true }, record("Sakura", 1, "SECRET"));
    expect(readdirSync(dir).length).toBe(before + 1);
  });

  it("markdown の表が足される・既存の見出しを消さん・新しい方が上（FR-7）", async () => {
    const docPath = join(dir, "model-compare.md");
    writeFileSync(
      docPath,
      "# モデル比較\n\n説明行\n\n## 2026-01-01（commit old0000）\n\nold-table\n",
      "utf8",
    );
    const { deps } = fakeDeps();
    await runModelCompare(deps, options(dir));
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("# モデル比較");
    expect(doc).toContain("## 2026-01-01（commit old0000）");
    expect(doc).toContain("old-table");
    const newIndex = doc.indexOf("（commit abc1234）");
    const oldIndex = doc.indexOf("## 2026-01-01");
    expect(newIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeLessThan(oldIndex);
    // 4 行分の表（役・正答・拒否の列）が入っている。
    expect(doc).toContain("| 既定 | deepseek/deepseek-v4.1-flash-1017 |");
    expect(doc).toContain("出典: pnpm --filter @v2/bench model-compare --");
  });

  it("404 のモデルが unavailable になり、ほかは続く（FR-8）", async () => {
    const { deps } = fakeDeps();
    deps.runRecall = async (spec) =>
      spec.model === "deepseek/deepseek-v3.2"
        ? { ok: false, detail: "404 No endpoints found for deepseek/deepseek-v3.2" }
        : recallOk(0.6);
    const { code, report } = await runModelCompare(deps, options(dir));
    expect(code).toBe(0);
    const rows = report?.rows ?? [];
    const v32 = rows.find((row) => row.model === "deepseek/deepseek-v3.2");
    expect(v32).toMatchObject({ status: "unavailable", reason: "not_found" });
    for (const row of rows.filter((r) => r.model !== "deepseek/deepseek-v3.2")) {
      expect(row.status).toBe("ok");
    }
  });

  it("見込みが上限を超えると 5 で呼ばん（NFR-1）", async () => {
    const { deps, calls } = fakeDeps({
      fetchPrices: async () => ({
        "deepseek/deepseek-v4.1-flash-1017": { inputUsd: 10, outputUsd: 10 },
        "deepseek/deepseek-v4.1-flash": { inputUsd: 10, outputUsd: 10 },
        "cognitivecomputations/dolphin-mistral-24b-venice-edition": {
          inputUsd: 10,
          outputUsd: 10,
        },
        "deepseek/deepseek-v3.2": { inputUsd: 10, outputUsd: 10 },
      }),
    });
    const { code, report } = await runModelCompare(deps, options(dir));
    expect(code).toBe(5);
    expect(report).toBeNull();
    expect(calls.recall).toHaveLength(0);
    expect(calls.script).toHaveLength(0);
  });

  it("--dry-run は見込みを出して終わり、試験台も台本も呼ばん（FR-9）", async () => {
    const { deps, calls } = fakeDeps();
    const { code } = await runModelCompare(deps, options(dir, { dryRun: true }));
    expect(code).toBe(0);
    expect(calls.recall).toHaveLength(0);
    expect(calls.script).toHaveLength(0);
    expect(calls.logs.some((line) => line.includes("見込み"))).toBe(true);
    expect(calls.logs.some((line) => line.includes("呼び出し"))).toBe(true);
  });

  it("モデル用の env は V2_MODEL を消して 1 本だけの列を入れる（制約）", () => {
    const env = envForModel(
      { V2_MODEL: "pinned/override", V2_MODEL_CHAIN: "old", OTHER: "keep" },
      COMPARE_MODELS[1],
    );
    expect(env.V2_MODEL).toBeUndefined();
    expect(env.OTHER).toBe("keep");
    expect(JSON.parse(env.V2_MODEL_CHAIN ?? "[]")).toEqual([
      { model: "deepseek/deepseek-v4.1-flash", providerOnly: ["Venice"] },
    ]);
    // 元の env は汚さん。
  });

  it("鍵が無い時は 4 で 1 ターンも送らん（制約）", async () => {
    const { deps, calls } = fakeDeps({ env: {} });
    const { code } = await runModelCompare(deps, options(dir));
    expect(code).toBe(4);
    expect(calls.recall).toHaveLength(0);
    expect(calls.errs.join("\n")).toContain("missing: OPENROUTER_API_KEY");
  });
});
