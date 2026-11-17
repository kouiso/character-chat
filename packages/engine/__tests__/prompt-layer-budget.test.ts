import { resolveContextBudget } from "../src/context-budget";
import {
  measureContextUsage,
  packSummaries,
  PERSONA_BLOCK_HEADER,
  PROMPT_LAYER_BUDGET,
  PromptBudgetExceededError,
  SUMMARY_BLOCK_HEADER,
} from "../src/prompt-layer-budget";

import type { ComposedPrompt } from "../src/types";

const promptOf = (messages: { role: "user" | "assistant"; content: string }[]): ComposedPrompt => ({
  version: "v0002",
  system: "指示",
  messages,
});

describe("packSummaries", () => {
  test("見出し込みの合計が予算内なら全部入れる", () => {
    const list = [
      { level: 2, text: "全体" },
      { level: 1, text: "新しい部分" },
    ];
    expect(packSummaries(list, 10_000)).toEqual(["全体", "新しい部分"]);
  });
  test("予算を超えると古い level 1 から外し、エントリの途中では切らない", () => {
    const list = [
      { level: 2, text: "L2" },
      { level: 1, text: "古いL1" },
      { level: 1, text: "新しいL1" },
    ];
    const budget = SUMMARY_BLOCK_HEADER.length + "L2\n新しいL1".length;
    expect(packSummaries(list, budget)).toEqual(["L2", "新しいL1"]);
    const tighter = SUMMARY_BLOCK_HEADER.length + "L2".length;
    expect(packSummaries(list, tighter)).toEqual(["L2"]);
  });
  test("level 2 だけでも収まらない時は空にし、要約塊自体を出さない", () => {
    const list = [{ level: 2, text: "長".repeat(100) }];
    expect(packSummaries(list, 10)).toEqual([]);
    expect(packSummaries([], 10_000)).toEqual([]);
  });
});

describe("measureContextUsage", () => {
  const parts = {
    layers: { summary: null, memory: null, documents: null, persona: null },
    omittedHistoryMessages: 0,
    oldestIncludedTurn: null,
  };
  test("層ごとの字数と合計・窓の境目を記録する", () => {
    const summary = `${SUMMARY_BLOCK_HEADER}あらすじ`;
    const persona = `${PERSONA_BLOCK_HEADER}人物像`;
    const prompt = promptOf([
      { role: "user", content: summary },
      { role: "user", content: persona },
      { role: "user", content: "過去" },
      { role: "assistant", content: "返事" },
      { role: "user", content: "今回" },
    ]);
    const usage = measureContextUsage(prompt, {
      ...parts,
      layers: { ...parts.layers, summary, persona },
      omittedHistoryMessages: 3,
      oldestIncludedTurn: 187,
    });
    expect(usage).toMatchObject({
      system: "指示".length,
      summary: summary.length,
      memory: 0,
      documents: 0,
      persona: persona.length,
      history: "過去返事".length,
      current: "今回".length,
      omittedHistoryMessages: 3,
      oldestIncludedTurn: 187,
    });
    expect(usage.total).toBe(
      usage.system + usage.summary + usage.persona + usage.history + usage.current,
    );
  });
  test("組み立てた層と指示文がずれた時は計測を誤魔化さず止める", () => {
    const prompt = promptOf([
      { role: "user", content: "別の塊" },
      { role: "user", content: "今" },
    ]);
    expect(() =>
      measureContextUsage(prompt, {
        ...parts,
        layers: { ...parts.layers, summary: "記録と違う" },
      }),
    ).toThrow("ずれとる");
  });
  test("固定層が上限を超えた時は PromptBudgetExceededError で失敗する", () => {
    const prompt = promptOf([{ role: "user", content: "今" }]);
    const big: ComposedPrompt = { ...prompt, system: "超".repeat(PROMPT_LAYER_BUDGET.system + 1) };
    expect(() => measureContextUsage(big, parts)).toThrow(PromptBudgetExceededError);
    try {
      measureContextUsage(big, parts);
    } catch (error) {
      expect(error).toBeInstanceOf(PromptBudgetExceededError);
      expect((error as PromptBudgetExceededError).usage.system).toBe(
        PROMPT_LAYER_BUDGET.system + 1,
      );
    }
  });
  test("環境変数で上げた履歴予算は実効予算で検査する", () => {
    const history = "史".repeat(13_000);
    const prompt = promptOf([
      { role: "user", content: history },
      { role: "user", content: "今" },
    ]);
    expect(() => measureContextUsage(prompt, parts)).toThrow(PromptBudgetExceededError);
    const raised = measureContextUsage(prompt, {
      ...parts,
      budget: resolveContextBudget({ historyCharacters: 14_000 }),
    });
    expect(raised.history).toBe(13_000);
  });
});
