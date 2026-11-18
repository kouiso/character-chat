// RIT-99 の通し確認（fake モード）。本番の抜き出し→埋め込み→検索→順位づけ→あらすじ
// →記憶ジョブを全部通して、植えた 5 つの事実が +50/+200 で帰ってくるかを測る。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { applyLocalMigrations } from "@v2/cf/migrate";
import { and, eq, inArray } from "drizzle-orm";
import { v2MemoryTable } from "@v2/db";
import type { TurnModel } from "@v2/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFakeAi } from "./memory-bench/fake-ai";
import { createFakeChat, type FakeChatOptions } from "./memory-bench/fake-chat";
import { createFakeExtractor } from "./memory-bench/fake-extractor";
import {
  chargeableCalls,
  countEmbeddingAi,
  createCallBudget,
  CountedChatModel,
  runArm,
  type ArmRunResult,
  type CallBudget,
} from "./memory-bench/harness";
import { buildScenario, FACTS, type RecallScenario } from "./memory-bench/recall-scenario";
import {
  armReportSchema,
  memoryRecallReportSchema,
  type ArmName,
  type MemoryRecallReport,
} from "./memory-bench/report";
import { createLocalVectorIndex } from "./memory-bench/vector-index";

let template: string;
beforeAll(() => {
  template = mkdtempSync(path.join(tmpdir(), "memory-bench-e2e-tpl-"));
  applyLocalMigrations({ persistRoot: template, quiet: true });
}, 300_000);
afterAll(() => rmSync(template, { recursive: true, force: true }));

const scenario = buildScenario();

const fakeArm = async (
  arm: ArmName,
  opts: {
    budget?: CallBudget;
    sabotage?: "retrieval-off" | null;
    scenarioOverride?: RecallScenario;
    summary?: FakeChatOptions["summary"];
    dropFactsFromCheat?: boolean;
  } = {},
): Promise<ArmRunResult> => {
  const useScenario = opts.scenarioOverride ?? scenario;
  const budget = opts.budget ?? createCallBudget({ limit: 10_000, usdLimit: 10_000 });
  const vectorIndex = createLocalVectorIndex();
  const model = new CountedChatModel(
    createFakeChat({ questions: useScenario.questions, summary: opts.summary ?? "blank" }),
    budget,
  );
  const extractionModel = new CountedChatModel(
    createFakeExtractor(useScenario.extractorTable) as unknown as TurnModel,
    budget,
    { fixedKind: "extraction" },
  );
  let tick = 1_700_000_000_000;
  const result = await runArm({
    scenario: useScenario,
    arm,
    persistTemplate: template,
    model,
    extractionModel,
    bindings: {
      V2_RAG_ENABLED: "1",
      AI: countEmbeddingAi(createFakeAi(), budget),
      MEMORY_INDEX: vectorIndex,
    },
    vectorIndex,
    budget,
    sabotage: opts.sabotage,
    character: opts.dropFactsFromCheat
      ? {
          id: "bench-character",
          name: "想起役",
          systemPrompt: "ただの店員。",
          greeting: "こんにちは。",
        }
      : undefined,
    now: () => (tick += 7),
    sleep: () => Promise.resolve(),
  });
  return result;
};

describe("memory recall 本番経路", () => {
  it(
    "台本どおりに記憶が作られ・混ぜ物は植えた記憶を置き換えない",
    { timeout: 240_000 },
    async () => {
      const result = await fakeArm("retrieval");
      try {
        const rows = await result.db
          .select()
          .from(v2MemoryTable)
          .where(
            and(
              inArray(
                v2MemoryTable.subject,
                FACTS.map((fact) => fact.factId),
              ),
              eq(v2MemoryTable.conversationId, result.conversationId),
            ),
          );
        expect(rows).toHaveLength(5);
        for (const row of rows) {
          expect(row.supersededBy).toBeNull();
          expect(row.embedding).not.toBeNull();
        }
        // 索引にも入っている（5 件以上: 植えた 5 + 混ぜ物等）
        expect(result.vectorIndex?.count() ?? 0).toBeGreaterThanOrEqual(5);
      } finally {
        await result.cleanup();
      }
    },
  );

  it("反則版は 10/10・記憶なしは 0/10（健全性ゲートの両側）", { timeout: 300_000 }, async () => {
    const cheat = await fakeArm("cheat");
    try {
      expect(cheat.arm.asked).toBe(10);
      expect(cheat.arm.correct).toBe(10);
      expect(armReportSchema.parse(cheat.arm)).toBeTruthy();
      // 返事の本文（「紅茶だよね（n）」等）は報告に出ない（FR-11 / SENTINEL 確認）。
      const serialized = JSON.stringify(cheat.arm);
      for (const secret of ["紅茶", "トラジロウ", "セロリ", "だよね", "覚えてない"])
        expect(serialized).not.toContain(secret);
    } finally {
      await cheat.cleanup();
    }
    const none = await fakeArm("none");
    try {
      expect(none.arm.asked).toBe(10);
      expect(none.arm.correct).toBe(0);
    } finally {
      await none.cleanup();
    }
  });

  it("決定論: 同じ設定の none 腕 2 回は同じ報告値になる", { timeout: 300_000 }, async () => {
    const first = await fakeArm("none");
    await first.cleanup();
    const second = await fakeArm("none");
    await second.cleanup();
    expect(second.arm).toEqual(first.arm);
  });
});

describe("破壊試験（仕組みが壊れたら数が変わる事の確かめ）", () => {
  it("検索を常に空にした腕は 0/10", { timeout: 240_000 }, async () => {
    const result = await fakeArm("retrieval", { sabotage: "retrieval-off" });
    try {
      expect(result.arm.correct).toBe(0);
    } finally {
      await result.cleanup();
    }
  });

  it(
    "混ぜ物を同じ主語にすると drink が +200 で落ち competitorAnswered になる",
    { timeout: 240_000 },
    async () => {
      const sabotaged = buildScenario({
        competitorSubject: (fact) => fact.factId,
      });
      const result = await fakeArm("retrieval", { scenarioOverride: sabotaged });
      try {
        const drink200 = result.arm.checks.find(
          (check) => check.factId === "drink" && check.distance === 200,
        );
        expect(drink200?.correct).toBe(false);
        expect(drink200?.competitorAnswered).toBe(true);
      } finally {
        await result.cleanup();
      }
    },
  );

  it("反則版の文から事実を外すと点数が下がる", { timeout: 240_000 }, async () => {
    const result = await fakeArm("cheat", { dropFactsFromCheat: true });
    try {
      expect(result.arm.correct).toBeLessThan(10);
    } finally {
      await result.cleanup();
    }
  });

  it("偽あらすじの echo 版では +200 側の inSummary が 5/5", { timeout: 240_000 }, async () => {
    const result = await fakeArm("retrieval", { summary: "echo" });
    try {
      const at200 = result.arm.checks.filter((check) => check.distance === 200);
      expect(at200).toHaveLength(5);
      expect(at200.every((check) => check.inSummary)).toBe(true);
    } finally {
      await result.cleanup();
    }
  });
});

describe("上限・報告の形", () => {
  it(
    "呼び出し上限 3 回で call-limit 止まり（数は 3 を超えない）",
    { timeout: 120_000 },
    async () => {
      const budget = createCallBudget({ limit: 3, usdLimit: 10_000 });
      const result = await fakeArm("cheat", { budget });
      try {
        expect(result.aborted).toBe("call-limit");
        expect(chargeableCalls(budget)).toBeLessThanOrEqual(3);
      } finally {
        await result.cleanup();
      }
    },
  );

  it("報告が MemoryRecallReport の zod を通る・本文は入らない", () => {
    const report: MemoryRecallReport = {
      kind: "memory-recall",
      schemaVersion: 1,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      gitSha: "0".repeat(40),
      mode: "fake",
      models: { chat: "fake-judge", extraction: "fake-table", embedding: "fake-bigram-1024" },
      arms: {
        none: {
          asked: 10,
          correct: 0,
          ratio: 0,
          byDistance: { "50": { asked: 5, correct: 0 }, "200": { asked: 5, correct: 0 } },
          checks: [],
        },
      },
      valid: true,
      invalidReason: null,
      calls: { chat: 0, extraction: 0, summary: 0, embedding: 0 },
      estimatedUsd: null,
      aborted: null,
      sabotage: null,
    };
    expect(memoryRecallReportSchema.parse(report)).toBeTruthy();
    const body = JSON.stringify(report);
    for (const secret of ["紅茶だよ", "私の好きな飲み物", "SENTINEL-7Q"])
      expect(body).not.toContain(secret);
  });
});
