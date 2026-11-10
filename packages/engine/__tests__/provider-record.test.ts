import { ChatGenerationChunk } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { createTurnGraph, runTurn } from "../src/graph";
import { createMemoryTurnStore } from "../src/memory-store";

import type { CharacterSheet, TurnEvent } from "../src/types";
import type { AIMessageChunk } from "@langchain/core/messages";

// RIT-100: 返事を作ったモデルと実行先が毎回記録されることの確かめ。
// OpenRouter の SSE chunk は id=gen-… を持つので、fake の chunk に同じ形で載せる。

const VALID_XML =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";

const character: CharacterSheet = {
  id: "char-1",
  name: "テスト子",
  systemPrompt: "一人称: わたし\n二人称: あなた\n語尾: 「〜だよ」「〜なの」",
  greeting: "はじめまして、よろしくね",
};

// stream chunk の message.id に OpenRouter 形式の生成 id を載せる fake。
class UpstreamIdModel extends FakeListChatModel {
  upstreamId = "gen-test-0001";

  _createResponseChunk(text: string, generationInfo?: Record<string, unknown>) {
    const chunk = super._createResponseChunk(text, generationInfo);
    (chunk.message as AIMessageChunk).id = this.upstreamId;
    return new ChatGenerationChunk({
      message: chunk.message as AIMessageChunk,
      text: chunk.text,
      generationInfo: chunk.generationInfo,
    });
  }
}

const drain = async (events: AsyncIterable<unknown>): Promise<void> => {
  const iterator = events[Symbol.asyncIterator]();
  while (!(await iterator.next()).done) {
    // 進めるだけ。
  }
};

const isGenerationEvent = (event: TurnEvent): event is Extract<TurnEvent, { type: "generation" }> =>
  event.type === "generation";

describe("実行先の記録（RIT-100）", () => {
  test("providerLookup が引いた実行先と上流 id が generation に残る", async () => {
    const store = createMemoryTurnStore();
    const providerLookup = vi.fn().mockResolvedValue("test-provider");
    const graph = createTurnGraph({
      model: new UpstreamIdModel({ responses: [VALID_XML] }),
      store,
      extendBelowRatio: 0,
      providerLookup,
    });
    await drain(
      runTurn(graph, { conversationId: "conv-1", userText: "こんにちは", character }, "conv-1"),
    );
    expect(providerLookup).toHaveBeenCalledWith("gen-test-0001");
    const saved = store.turns.get("conv-1") ?? [];
    const generation = saved[0]?.events.find(isGenerationEvent);
    expect(generation).toMatchObject({
      provider: "test-provider",
      upstreamId: "gen-test-0001",
    });
  });

  test("lookup が落ちてもターンは完了し、provider は unknown で残る", async () => {
    const store = createMemoryTurnStore();
    const providerLookup = vi.fn().mockRejectedValue(new Error("stats down"));
    const graph = createTurnGraph({
      model: new UpstreamIdModel({ responses: [VALID_XML] }),
      store,
      extendBelowRatio: 0,
      providerLookup,
    });
    await drain(
      runTurn(graph, { conversationId: "conv-1", userText: "こんにちは", character }, "conv-1"),
    );
    const saved = store.turns.get("conv-1") ?? [];
    const generation = saved[0]?.events.find(isGenerationEvent);
    expect(generation).toMatchObject({ provider: "unknown", upstreamId: "gen-test-0001" });
  });

  test("即時 lookup で引けん分は onProviderUnresolved へ generationId と上流 id が届く", async () => {
    const store = createMemoryTurnStore();
    const providerLookup = vi.fn().mockResolvedValue(null);
    const onProviderUnresolved = vi.fn();
    const graph = createTurnGraph({
      model: new UpstreamIdModel({ responses: [VALID_XML] }),
      store,
      extendBelowRatio: 0,
      providerLookup,
      onProviderUnresolved,
    });
    await drain(
      runTurn(graph, { conversationId: "conv-1", userText: "こんにちは", character }, "conv-1"),
    );
    const saved = store.turns.get("conv-1") ?? [];
    const generation = saved[0]?.events.find(isGenerationEvent);
    expect(generation).toMatchObject({ provider: "unknown", upstreamId: "gen-test-0001" });
    expect(onProviderUnresolved).toHaveBeenCalledWith(generation?.generationId, "gen-test-0001");
  });

  test("即時 lookup で引けた時は onProviderUnresolved を呼ばん", async () => {
    const store = createMemoryTurnStore();
    const onProviderUnresolved = vi.fn();
    const graph = createTurnGraph({
      model: new UpstreamIdModel({ responses: [VALID_XML] }),
      store,
      extendBelowRatio: 0,
      providerLookup: vi.fn().mockResolvedValue("test-provider"),
      onProviderUnresolved,
    });
    await drain(
      runTurn(graph, { conversationId: "conv-1", userText: "こんにちは", character }, "conv-1"),
    );
    expect(onProviderUnresolved).not.toHaveBeenCalled();
  });

  test("上流 id が無い応答では lookup を呼ばず provider は null", async () => {
    const store = createMemoryTurnStore();
    const providerLookup = vi.fn();
    const graph = createTurnGraph({
      model: new FakeListChatModel({ responses: [VALID_XML] }),
      store,
      extendBelowRatio: 0,
      providerLookup,
    });
    await drain(
      runTurn(graph, { conversationId: "conv-1", userText: "こんにちは", character }, "conv-1"),
    );
    expect(providerLookup).not.toHaveBeenCalled();
    const saved = store.turns.get("conv-1") ?? [];
    const generation = saved[0]?.events.find(isGenerationEvent);
    expect(generation?.provider).toBeNull();
    expect(generation?.upstreamId).toBeNull();
  });
});
