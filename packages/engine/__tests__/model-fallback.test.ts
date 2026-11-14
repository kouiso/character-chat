// RIT-102: 拒否・時間切れ・障害で逃げ道へ順に落ちる試験。
import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { createTurnGraph, runTurn } from "../src/graph";
import { createMemoryTurnStore, type MemoryTurnStore } from "../src/memory-store";

import type { CharacterSheet, TurnEvent } from "../src/types";

const VALID_XML =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";
const REFUSAL = "申し訳ありませんが、そのような内容は作成できません。倫理に反します。";

const character: CharacterSheet = {
  id: "char-1",
  name: "テスト子",
  systemPrompt: "一人称: わたし",
  greeting: "はじめまして",
};

const xmlChunk = (text: string) =>
  new ChatGenerationChunk({
    message: new AIMessageChunk({ content: text }),
    text,
  });

// 5xx・ネットワーク障害を起こすモデル。
class ThrowingModel extends FakeListChatModel {
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    // 1 塊も返さず最初の next で落ちる上流を再現する（空の yield* でジェネレータの形だけ保つ）。
    yield* [];
    throw new Error("503 upstream unavailable");
  }
}

// 締切まで応答しないモデル。abort で待ちをやめるので試験は締切の値だけ速い。
class HangingModel extends FakeListChatModel {
  async *_streamResponseChunks(
    _messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): AsyncGenerator<ChatGenerationChunk> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    yield xmlChunk("届かん");
  }
}

// 長い本文を 1 チャンクで返す（REFUSAL_SAFE_CHARS 越えで配信が始まるかの確認用）。
class BigOkModel extends FakeListChatModel {
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    yield xmlChunk(VALID_XML.padEnd(400, "。"));
  }
}

const drain = async (events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> => {
  const out: TurnEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const generationOf = (store: MemoryTurnStore) => {
  const turn = store.turns.get("conv-fb")?.[0];
  const generation = turn?.events.find((event) => event.type === "generation");
  if (!generation || generation.type !== "generation") throw new Error("generation イベント無し");
  return generation;
};

const buildGraph = (
  models: { name: string; model: FakeListChatModel }[],
  store = createMemoryTurnStore(),
) =>
  createTurnGraph({
    model: models[0].model,
    models,
    store,
    extendBelowRatio: 0,
  });

const input = { conversationId: "conv-fb", userText: "こんにちは", character };

describe("モデルの逃げ道（RIT-102）", () => {
  test("拒否したら逃げ道へ切り替わり、切り替え理由が generation.attempts に残る", async () => {
    const store = createMemoryTurnStore();
    const graph = buildGraph(
      [
        { name: "default", model: new FakeListChatModel({ responses: [REFUSAL] }) },
        { name: "escape1", model: new FakeListChatModel({ responses: [VALID_XML] }) },
      ],
      store,
    );
    const streamed = await drain(runTurn(graph, input, "conv-fb"));
    const generation = generationOf(store);
    expect(generation.model).toBe("escape1");
    expect(generation.status).toBe("ok");
    expect(generation.rawOutput).toBe(VALID_XML);
    expect(generation.attempts).toEqual([
      { model: "default", outcome: "refused", detail: expect.any(String) },
      { model: "escape1", outcome: "ok" },
    ]);
    // 拒否文は配信にも本文にも残らん。
    const tokens = streamed.filter((e) => e.type === "token").map((e) => e.text);
    expect(tokens.join("")).not.toContain("申し訳ありません");
  });

  test("5xx 例外でも逃げ道へ切り替わる", async () => {
    const store = createMemoryTurnStore();
    const graph = buildGraph(
      [
        { name: "default", model: new ThrowingModel({ responses: [] }) },
        { name: "escape1", model: new FakeListChatModel({ responses: [VALID_XML] }) },
      ],
      store,
    );
    await drain(runTurn(graph, input, "conv-fb"));
    const generation = generationOf(store);
    expect(generation.model).toBe("escape1");
    expect(generation.attempts?.[0]).toMatchObject({ model: "default", outcome: "error" });
  });

  test("時間切れで逃げ道へ切り替わり、締切の値が記録される", async () => {
    const store = createMemoryTurnStore();
    const graph = buildGraph(
      [
        { name: "default", model: new HangingModel({ responses: [] }) },
        { name: "escape1", model: new FakeListChatModel({ responses: [VALID_XML] }) },
      ],
      store,
    );
    await drain(runTurn(graph, { ...input, timeoutMs: 80 }, "conv-fb"));
    const generation = generationOf(store);
    expect(generation.model).toBe("escape1");
    expect(generation.timeoutMs).toBe(80);
    expect(generation.attempts?.[0]).toMatchObject({ model: "default", outcome: "timeout" });
  });

  test("全部のモデルが使えん時は status=error で黙らずに error イベントを流す", async () => {
    const store = createMemoryTurnStore();
    const graph = buildGraph(
      [
        { name: "default", model: new ThrowingModel({ responses: [] }) },
        { name: "escape1", model: new FakeListChatModel({ responses: [REFUSAL] }) },
      ],
      store,
    );
    const streamed = await drain(runTurn(graph, input, "conv-fb"));
    const generation = generationOf(store);
    expect(generation.status).toBe("error");
    expect(generation.error).toContain("全モデルで生成に失敗");
    expect(streamed.some((e) => e.type === "error")).toBe(true);
  });

  test("通常どおり返る時は 1 件の ok attempt で、長い本文は配信が追いつく", async () => {
    const store = createMemoryTurnStore();
    const graph = buildGraph(
      [{ name: "default", model: new BigOkModel({ responses: [] }) }],
      store,
    );
    const streamed = await drain(runTurn(graph, input, "conv-fb"));
    const generation = generationOf(store);
    expect(generation.attempts).toEqual([{ model: "default", outcome: "ok" }]);
    const tokens = streamed.filter((e) => e.type === "token").map((e) => e.text);
    expect(tokens.join("").length).toBeGreaterThan(300);
  });
});
