// RIT-99 harness の単体確認。重い通し実行は memory-recall-check.test.ts 側。
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { applyLocalMigrations } from "@v2/cf/migrate";
import { v2MemoryTable } from "@v2/db";
import type { TurnModel } from "@v2/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFakeAi } from "./fake-ai";
import { createFakeChat } from "./fake-chat";
import { createFakeExtractor } from "./fake-extractor";
import {
  countEmbeddingAi,
  createCallBudget,
  CountedChatModel,
  runArm,
  type CallBudget,
} from "./harness";
import {
  buildScenario,
  containsAnyAnswer,
  FACTS,
  FILLER_LINES,
  type RecallScenario,
} from "./recall-scenario";
import { createLocalVectorIndex } from "./vector-index";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

describe("台本", () => {
  it("全 205 ターン・役割は一つだけ・52 は聞く猫・56 は混ぜ物", () => {
    const { plans } = buildScenario();
    expect(plans).toHaveLength(205);
    expect(plans.map((plan) => plan.turn)).toEqual(
      Array.from({ length: 205 }, (_, index) => index + 1),
    );
    expect(plans.filter((plan) => plan.kind === "plant")).toHaveLength(5);
    expect(plans.filter((plan) => plan.kind === "ask")).toHaveLength(10);
    expect(plans.filter((plan) => plan.kind === "competitor")).toHaveLength(15);
    expect(plans.filter((plan) => plan.kind === "filler")).toHaveLength(175);
    expect(plans[51].kind).toBe("ask"); // turn 52（cat の聞くターン）
    expect(plans[51].kind === "ask" && plans[51].factIndex).toBe(1);
    expect(plans[55].kind).toBe("competitor"); // turn 56（52 を避けてずれた分）
  });

  it("全角の「３月１４日」も正答として数える", () => {
    expect(containsAnyAnswer("うん、３月１４日だよね", ["3月14日"])).toBe(true);
    expect(containsAnyAnswer("覚えてない", ["3月14日"])).toBe(false);
  });
});

describe("applyLocalMigrations quiet", () => {
  it("quiet:true は wrangler の文字を標準出力へ出さない", { timeout: 240_000 }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "memory-bench-quiet-"));
    try {
      const migratePath = path.join(REPO_ROOT, "packages/cf/src/migrate.ts");
      const scriptPath = path.join(dir, "run-quiet.ts");
      writeFileSync(
        scriptPath,
        `import { applyLocalMigrations } from ${JSON.stringify(migratePath)}; applyLocalMigrations({ persistRoot: ${JSON.stringify(dir)}, quiet: true });\n`,
      );
      const result = spawnSync("pnpm", ["exec", "tsx", scriptPath], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 200_000,
        // wrangler の進行表示は quiet でも stderr へ逃げるので、buffer は大きく取る。
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(result.error).toBeUndefined();
      expect(result.stdout).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 2 つの persist ルートが互いの行を見えない事の確かめ。短い台本で 2 腕分回す。
const miniScenario = (): RecallScenario => {
  const full = buildScenario();
  return {
    totalTurns: 4,
    facts: FACTS,
    plans: [
      { kind: "plant", turn: 1, factIndex: 0, userText: FACTS[0].plantText },
      { kind: "filler", turn: 2, lineIndex: 0, userText: FILLER_LINES[0] },
      { kind: "competitor", turn: 3, factIndex: 0, userText: FACTS[0].competitorText },
      { kind: "ask", turn: 4, factIndex: 0, distance: 50, userText: FACTS[0].askText },
    ],
    extractorTable: full.extractorTable,
    questions: full.questions,
  };
};

describe("D1 の分離", () => {
  let template: string;
  beforeAll(() => {
    template = mkdtempSync(path.join(tmpdir(), "memory-bench-tpl-test-"));
    applyLocalMigrations({ persistRoot: template, quiet: true });
  }, 240_000);
  afterAll(() => rmSync(template, { recursive: true, force: true }));

  const fakeDeps = (budget: CallBudget) => {
    const vectorIndex = createLocalVectorIndex();
    const scenario = miniScenario();
    return {
      vectorIndex,
      scenario,
      model: new CountedChatModel(
        createFakeChat({ questions: scenario.questions, summary: "blank" }),
        budget,
      ),
      extractionModel: new CountedChatModel(
        createFakeExtractor(scenario.extractorTable) as unknown as TurnModel,
        budget,
        { fixedKind: "extraction" },
      ),
      bindings: {
        V2_RAG_ENABLED: "1",
        AI: countEmbeddingAi(createFakeAi(), budget),
        MEMORY_INDEX: vectorIndex,
      },
    };
  };

  it("2 回回しても互いの行は見えない（各行数はその実行分だけ）", { timeout: 240_000 }, async () => {
    const counts: number[] = [];
    for (let run = 0; run < 2; run += 1) {
      const budget = createCallBudget({ limit: 10_000, usdLimit: 10_000 });
      const deps = fakeDeps(budget);
      const result = await runArm({
        scenario: deps.scenario,
        arm: "retrieval",
        persistTemplate: template,
        model: deps.model,
        extractionModel: deps.extractionModel,
        bindings: deps.bindings,
        vectorIndex: deps.vectorIndex,
        budget,
        now: Date.now,
      });
      const rows = await result.db.select().from(v2MemoryTable);
      counts.push(rows.length);
      await result.cleanup();
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBeGreaterThan(0);
  });
});
