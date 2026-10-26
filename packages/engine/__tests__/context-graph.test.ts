import { FakeListChatModel } from "@langchain/core/utils/testing";
import { emptyLedger } from "@v2/prompt";

import { DEFAULT_CONTEXT_BUDGET } from "../src/context-window";
import { createTurnGraph, runTurn } from "../src/graph";
import { createMemoryTurnStore } from "../src/memory-store";

import type { CharacterSheet, HistoryMessage, TurnEvent } from "../src/types";
import type { BaseMessage } from "@langchain/core/messages";

const character: CharacterSheet = {
  id: "synthetic-guide",
  name: "案内役",
  systemPrompt: "一人称: わたし\n二人称: あなた\n散歩と天気について話す。",
  greeting: "こんにちは",
};
const RESPONSE = "<response><dialogue>わたしは駅前の公園に行くよ。</dialogue></response>";
const SECOND_RESPONSE = "<response><dialogue>明日は図書館で本を探そう。</dialogue></response>";
const charsOf = (text: string): number => [...text].length;
const textsOf = (input: unknown): string[] =>
  (input as BaseMessage[]).map((message) => {
    if (typeof message.content !== "string") throw new Error("Expected synthetic text input");
    return message.content;
  });
const drain = async (events: AsyncIterable<TurnEvent>): Promise<void> => {
  for await (const event of events) void event;
};

const storeWithHistory = (history: HistoryMessage[]) => {
  const store = createMemoryTurnStore();
  jest.spyOn(store, "load").mockResolvedValue({ history, ledger: emptyLedger(), turn: 1 });
  return store;
};

describe("engine の会話コンテキスト接続", () => {
  test("generate が全履歴ではなく予算内の直近会話を受け、記録もモデル入力と一致する", async () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "昔の天気の話" },
      { role: "assistant", content: "晴れだよ" },
      { role: "user", content: "昨日" },
      { role: "assistant", content: "雨" },
    ];
    const store = storeWithHistory(history);
    const model = new FakeListChatModel({ responses: [RESPONSE] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({
      model,
      store,
      extendBelowRatio: 0,
      contextBudget: { recentChars: 7 },
    });
    await drain(
      runTurn(graph, { conversationId: "window", userText: "今日😀", character }, "window"),
    );

    const actual = textsOf(streamSpy.mock.calls[0]?.[0]);
    expect(actual.slice(1)).toEqual(["昨日", "雨", "今日😀"]);
    expect(actual.slice(1).reduce((sum, text) => sum + charsOf(text), 0)).toBe(6);
    const generation = store.turns
      .get("window")?.[0]
      ?.events.find((event) => event.type === "generation");
    expect(generation).toMatchObject({
      systemPrompt: actual[0],
      request: [...history.slice(2), { role: "user", content: "今日😀" }],
    });
  });

  test("既定設定でも長い履歴を絞り、最新入力を含める", async () => {
    const store = storeWithHistory(
      Array.from({ length: 30 }, (_, index) => ({
        role: "user",
        content: `散歩${index} ${"晴れ".repeat(250)}`,
      })),
    );
    const model = new FakeListChatModel({ responses: [RESPONSE] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });
    await drain(
      runTurn(graph, { conversationId: "default", userText: "明日の予定", character }, "default"),
    );
    const messages = textsOf(streamSpy.mock.calls[0]?.[0]);
    expect(messages.slice(1).reduce((sum, text) => sum + charsOf(text), 0)).toBeLessThanOrEqual(
      DEFAULT_CONTEXT_BUDGET.recentChars,
    );
    expect(messages.length).toBeLessThan(32);
    expect(messages.at(-1)).toBe("明日の予定");
  });

  test("極端な長文一通でもモデルには末尾だけを渡し、保存には原文を残す", async () => {
    const userText = `${"今日は良い天気です。".repeat(100_000)}次は公園😀`;
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [RESPONSE] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({
      model,
      store,
      extendBelowRatio: 0,
      contextBudget: { recentChars: 5 },
    });
    await drain(runTurn(graph, { conversationId: "long", userText, character }, "long"));
    expect(textsOf(streamSpy.mock.calls[0]?.[0]).slice(1)).toEqual(["次は公園😀"]);
    expect(store.turns.get("long")?.[0]?.userText).toBe(userText);
    const snapshot = await graph.getState({ configurable: { thread_id: "long" } });
    expect(snapshot.values.prompt).toMatchObject({
      contextUsage: { recentChars: 5, truncatedLatest: true, omittedMessages: 0 },
    });
  });

  test("同じ thread の次ターンで窓を組み直し、前ターンから古い会話が復活しない", async () => {
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [RESPONSE, SECOND_RESPONSE] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({
      model,
      store,
      extendBelowRatio: 0,
      contextBudget: { recentChars: 4 },
    });
    await drain(
      runTurn(graph, { conversationId: "repeat", userText: "昨日", character }, "repeat"),
    );
    await drain(
      runTurn(graph, { conversationId: "repeat", userText: "今日", character }, "repeat"),
    );
    expect(textsOf(streamSpy.mock.calls[1]?.[0]).slice(1)).toEqual(["今日"]);
    expect(store.turns.get("repeat")).toHaveLength(2);
  });

  test("空入力を最新メッセージとして残す", async () => {
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [RESPONSE] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({ model, store, extendBelowRatio: 0 });
    await drain(runTurn(graph, { conversationId: "empty", userText: "", character }, "empty"));
    expect(textsOf(streamSpy.mock.calls[0]?.[0]).slice(1)).toEqual([""]);
  });

  test("窓から外した履歴を反復語の採集経由で system へ戻さない", async () => {
    const old = "青い傘を駅前の図書館へ届けた";
    const store = storeWithHistory([
      { role: "assistant", content: old },
      { role: "user", content: "了解" },
      { role: "assistant", content: old },
    ]);
    const model = new FakeListChatModel({ responses: [RESPONSE] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({
      model,
      store,
      extendBelowRatio: 0,
      contextBudget: { recentChars: 2 },
    });
    await drain(
      runTurn(graph, { conversationId: "phrases", userText: "今日", character }, "phrases"),
    );
    const messages = textsOf(streamSpy.mock.calls[0]?.[0]);
    expect(messages[0]).not.toContain(old);
    expect(messages.slice(1)).toEqual(["今日"]);
  });

  test.each(["extend", "regenerate"])(
    "%s にも追加指示の独立予算を適用し最新入力を保つ",
    async (kind) => {
      const store = createMemoryTurnStore();
      const repeated = "散歩の途中で青い空を眺めながら駅まで歩いていこう";
      const response =
        kind === "extend" ? RESPONSE : `<action>${repeated}</action><action>${repeated}</action>`;
      const model = new FakeListChatModel({ responses: [response, SECOND_RESPONSE] });
      const invokeSpy = jest.spyOn(model, "invoke");
      const graph = createTurnGraph({
        model,
        store,
        extendBelowRatio: kind === "extend" ? 0.8 : 0,
        contextBudget: { recentChars: 4, instructionChars: 20 },
      });
      await drain(runTurn(graph, { conversationId: kind, userText: "今日😀", character }, kind));
      expect(invokeSpy).toHaveBeenCalled();
      for (const call of invokeSpy.mock.calls) {
        const messages = textsOf(call[0]);
        expect(messages.slice(1, -1)).toEqual(["今日😀"]);
        expect(charsOf(messages.at(-1) ?? "")).toBe(20);
        expect(messages.reduce((sum, text) => sum + charsOf(text), 0)).toBeLessThanOrEqual(
          DEFAULT_CONTEXT_BUDGET.systemChars + 4 + 20,
        );
      }
    },
  );

  test("system 予算不足は provider 呼出し・保存の前に拒否する", async () => {
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [RESPONSE] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({ model, store, contextBudget: { systemChars: 1 } });
    await expect(
      drain(
        runTurn(graph, { conversationId: "invalid", userText: "こんにちは", character }, "invalid"),
      ),
    ).rejects.toThrow("System context exceeds its budget");
    expect(streamSpy).not.toHaveBeenCalled();
    expect(store.turns.size).toBe(0);
  });
});
