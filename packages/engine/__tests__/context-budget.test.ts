import { FakeListChatModel } from "@langchain/core/utils/testing";
import { emptyLedger } from "@v2/prompt";

import { buildConversationContext } from "../src/context-budget";
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
});
