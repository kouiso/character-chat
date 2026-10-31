import { FakeListChatModel } from "@langchain/core/utils/testing";
import { emptyLedger } from "@v2/prompt";

import {
  buildConversationContext,
  ContextBudgetConfigError,
  contextBudgetFromEnv,
  DEFAULT_CONTEXT_BUDGET,
} from "../src/context-budget";
import { createTurnGraph, runTurn } from "../src/graph";

import type { HistoryMessage, SaveTurnInput } from "../src/types";

describe("conversation context budget", () => {
  test("200ターンでも直近の連続した履歴だけ残し、今回の発言を必ず最後に入れる", () => {
    const history: HistoryMessage[] = Array.from({ length: 400 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: String(i).padStart(3, "0"),
    }));
    const result = buildConversationContext(history, "今回", {
      historyCharacters: 12,
      historyMessages: 10,
    });
    expect(result.messages.map((message) => message.content)).toEqual([
      "396",
      "397",
      "398",
      "399",
      "今回",
    ]);
    expect(result.historyCharacters).toBe(12);
    expect(result.omittedMessages).toBe(396);
    expect(history).toHaveLength(400);
  });
  test("巨大な1通で予算を超えず、今回の発言を切らない", () => {
    const result = buildConversationContext(
      [{ role: "assistant", content: "長".repeat(100_000) }],
      "今の質問",
    );
    expect(result.messages).toEqual([{ role: "user", content: "今の質問" }]);
    expect(result.historyCharacters).toBe(0);
  });
  test("履歴の件数制限と0予算を尊重する", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "前" },
      { role: "assistant", content: "後" },
    ];
    expect(buildConversationContext(history, "今", { historyMessages: 1 }).messages).toHaveLength(
      2,
    );
    expect(buildConversationContext(history, "今", { historyCharacters: 0 }).messages).toHaveLength(
      1,
    );
  });
  test("不正な予算と収まらない今回の発言は黙って切り捨てず拒否する", () => {
    for (const value of [-1, NaN, Infinity, 1.5]) {
      expect(() => buildConversationContext([], "今", { historyCharacters: value })).toThrow(
        "Invalid context budget",
      );
    }
    expect(() => buildConversationContext([], "切らない", { currentMessageCharacters: 1 })).toThrow(
      "exceeds",
    );
  });
  test("実際にモデルへ渡すリクエストにも予算が適用される", async () => {
    const saved: SaveTurnInput[] = [];
    const graph = createTurnGraph({
      model: new FakeListChatModel({
        responses: [
          "<response><action>本を開く。</action><dialogue>こちらをご覧ください。</dialogue><inner>順番に案内しよう。</inner></response>",
        ],
      }),
      store: {
        load: async () => ({
          history: [
            { role: "assistant", content: "古い".repeat(10000) },
            { role: "user", content: "直近の質問" },
            { role: "assistant", content: "直近の回答" },
          ],
          ledger: emptyLedger(),
          turn: 201,
        }),
        saveTurn: async (input) => {
          saved.push(input);
        },
      },
      contextBudget: { historyCharacters: 20, historyMessages: 2 },
      extendBelowRatio: 0,
    });
    const turn = runTurn(
      graph,
      {
        conversationId: "budget-test",
        userText: "今回の質問",
        character: {
          id: "guide",
          name: "案内役",
          systemPrompt: "図書館の案内役。丁寧に話す。",
          greeting: "こんにちは。",
        },
      },
      "budget-test",
    );
    for await (const event of turn) {
      expect(event.type).not.toBe("error");
    }
    const generation = saved[0].events.find((event) => event.type === "generation");
    expect(generation?.type === "generation" ? generation.request : []).toEqual([
      { role: "user", content: "直近の質問" },
      { role: "assistant", content: "直近の回答" },
      { role: "user", content: "今回の質問" },
    ]);
  });
  test("履歴が空でも今回の発言だけを返す", () => {
    expect(buildConversationContext([], "今")).toEqual({
      messages: [{ role: "user", content: "今" }],
      historyCharacters: 0,
      omittedMessages: 0,
    });
  });
  test("字数予算ちょうどまでは入れ、1字でも超える1通は入れない", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "あいう" },
      { role: "assistant", content: "えお" },
    ];
    const exact = buildConversationContext(history, "今", { historyCharacters: 5 });
    expect(exact.messages.map((message) => message.content)).toEqual(["あいう", "えお", "今"]);
    expect(exact.historyCharacters).toBe(5);
    expect(exact.omittedMessages).toBe(0);
    const short = buildConversationContext(history, "今", { historyCharacters: 4 });
    expect(short.messages.map((message) => message.content)).toEqual(["えお", "今"]);
    expect(short.omittedMessages).toBe(1);
  });
  test("件数予算0は過去を送らず、今回の発言は残す", () => {
    const result = buildConversationContext([{ role: "assistant", content: "前" }], "今", {
      historyMessages: 0,
    });
    expect(result.messages).toEqual([{ role: "user", content: "今" }]);
    expect(result.omittedMessages).toBe(1);
  });
  test("直前の1通が字数予算を超えると、より古い短い履歴も送らない（連続性を優先）", () => {
    const result = buildConversationContext(
      [
        { role: "user", content: "短い" },
        { role: "assistant", content: "長".repeat(11) },
      ],
      "今",
      { historyCharacters: 10 },
    );
    expect(result.messages).toEqual([{ role: "user", content: "今" }]);
    expect(result.omittedMessages).toBe(2);
  });
});

describe("環境変数からの履歴予算", () => {
  test.each([
    ["未設定", {}],
    ["空文字", { V2_HISTORY_CHARACTERS: "", V2_HISTORY_MESSAGES: "" }],
  ])("%sなら既定値で組み立てられる", (_label, env) => {
    const overrides = contextBudgetFromEnv(env);
    expect({ ...DEFAULT_CONTEXT_BUDGET, ...overrides }).toEqual(DEFAULT_CONTEXT_BUDGET);
    expect(() => buildConversationContext([], "今", overrides)).not.toThrow();
  });
  test("wrangler の数値も文字列の整数も受け付ける", () => {
    expect(contextBudgetFromEnv({ V2_HISTORY_CHARACTERS: 500, V2_HISTORY_MESSAGES: "8" })).toEqual({
      historyCharacters: 500,
      historyMessages: 8,
    });
  });
  test('件数"0"は履歴なしとして今回の発言だけを送る', () => {
    const overrides = contextBudgetFromEnv({ V2_HISTORY_MESSAGES: "0" });
    expect(overrides).toEqual({ historyMessages: 0 });
    expect(
      buildConversationContext([{ role: "assistant", content: "前" }], "今", overrides).messages,
    ).toEqual([{ role: "user", content: "今" }]);
  });
  test.each([["-1"], [-1], ["abc"], ["1.5"], [1.5], [" 12"], ["1e3"], [NaN], [Infinity]])(
    "不正な値 %s は既定値へ逃がさず設定エラーにする",
    (value) => {
      for (const name of ["V2_HISTORY_CHARACTERS", "V2_HISTORY_MESSAGES"] as const) {
        expect(() => contextBudgetFromEnv({ [name]: value })).toThrow(ContextBudgetConfigError);
        expect(() => contextBudgetFromEnv({ [name]: value })).toThrow(name);
      }
    },
  );
});
