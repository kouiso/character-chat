import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { createTurnGraph, runTurn, type TurnInput } from "../src/graph";
import { createMemoryTurnStore } from "../src/memory-store";

import type { CharacterSheet, TurnEvent } from "../src/types";
import type { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";

// 2026-09-04 v2 arm（CI 89426095）: Sakura t6 が 43,204 字・63 分（latencyMs 3,807,055）を 1 ターンで
// 書き続け、CI の 90 分がそこで尽きて 2 本目が回らんかった。1 ターンの上限を 3 段（max_tokens /
// 受け取った字数 / 締切）で掛ける。

const character: CharacterSheet = {
  id: "char-1",
  name: "テスト子",
  systemPrompt: "一人称: わたし\n二人称: あなた",
  greeting: "はじめまして",
};

const VALID_XML =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";

const collect = async (
  graph: ReturnType<typeof createTurnGraph>,
  input: TurnInput,
): Promise<TurnEvent[]> => {
  const events: TurnEvent[] = [];
  for await (const event of runTurn(graph, input, input.conversationId)) events.push(event);
  return events;
};

const generationOf = (store: ReturnType<typeof createMemoryTurnStore>, conversationId: string) => {
  const saved = store.turns.get(conversationId) ?? [];
  const generation = saved[0]?.events.find((event) => event.type === "generation");
  if (!generation || generation.type !== "generation")
    throw new Error("generation が保存されてへん");
  return generation;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const textChunk = (text: string): ChatGenerationChunk =>
  new ChatGenerationChunk({ message: new AIMessageChunk({ content: text }), text });

// 終わらんモデル: 数 ms ごとに 1 字ずつ永遠に流す（実モデルが同じ文を延々と繰り返した状況）。
class NeverEndingChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  _llmType(): string {
    return "never-ending";
  }
  async _generate(): Promise<never> {
    throw new Error("invoke は使わん");
  }
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    yield textChunk("<action>");
    for (;;) {
      await sleep(5);
      yield textChunk("あ");
    }
  }
}

// 1 字も返さんモデル: abort されるまで待って、実クライアントと同じく signal の reason を投げる。
class HangingChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  _llmType(): string {
    return "hanging";
  }
  async _generate(): Promise<never> {
    throw new Error("invoke は使わん");
  }
  async *_streamResponseChunks(
    _messages: unknown,
    options: BaseChatModelCallOptions,
  ): AsyncGenerator<ChatGenerationChunk> {
    await new Promise<never>((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
        once: true,
      });
    });
    yield textChunk("届かん");
  }
}

describe("generate の上限: max_tokens", () => {
  test("段の目安字数 × 2.5 を [400, 1400] に丸めた maxTokens と AbortSignal を .stream の呼び出しオプションで渡す", async () => {
    const store = createMemoryTurnStore();
    const model = new FakeListChatModel({ responses: [VALID_XML, VALID_XML] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({ model, store });

    // conversation（220 字）→ ceil(550) = 550
    await collect(graph, { conversationId: "cap-1", userText: "一回目", character });
    expect(streamSpy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTokens: 550, signal: expect.any(AbortSignal) }),
    );

    // erotic（550 字）→ ceil(1375) = 1375（上限 1400 の内側）
    await collect(graph, {
      conversationId: "cap-2",
      userText: "一回目",
      character,
      phase: "erotic",
    });
    expect(streamSpy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTokens: 1375 }),
    );
  });
});

describe("generate の上限: 受け取った字数", () => {
  test("生の受信文字数が 2 × 目安 + 400 を超えたら stream を閉じ、truncated=chars を generation に立てて chunk/judge/persist は続く", async () => {
    const store = createMemoryTurnStore();
    // conversation の上限は 2 × 220 + 400 = 840 字。5,000 字超の本文を 1 字ずつ流す。
    const block = "<action>彼女の手の感触が心地よい。彼女の体の熱が伝わってくる。</action>";
    const endless = `<response>${block.repeat(120)}</response>`;
    expect(endless.length).toBeGreaterThan(5000);
    const model = new FakeListChatModel({ responses: [endless] });
    const streamSpy = jest.spyOn(model, "stream");
    const graph = createTurnGraph({ model, store });

    const events = await collect(graph, { conversationId: "cap-3", userText: "続けて", character });

    const generation = generationOf(store, "cap-3");
    expect(generation.truncated).toBe("chars");
    expect(generation.status).toBe("aborted");
    expect(generation.rawOutput.length).toBeGreaterThan(840);
    expect(generation.rawOutput.length).toBeLessThanOrEqual(841);
    // 閉じる時に request も abort しとる（実モデルでは fetch が止まる）。
    const options = streamSpy.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(options?.signal?.aborted).toBe(true);

    // 受け取った分は塊にして判定まで回る。途中で切れた塊は format で落ちて dropped になるので、両方を数える。
    expect(
      events.filter((event) => event.type === "chunk" || event.type === "dropped").length,
    ).toBeGreaterThan(0);
    expect(events[events.length - 1]?.type).toBe("done");
    expect(store.turns.get("cap-3")).toHaveLength(1);
  });
});

describe("generate の上限: 締切", () => {
  test("終わらんモデルでも timeoutMs で切れ、受け取った分で chunk/judge/persist が走り truncated=deadline が立つ", async () => {
    const store = createMemoryTurnStore();
    const graph = createTurnGraph({ model: new NeverEndingChatModel({}), store });

    const startedAt = Date.now();
    const events = await collect(graph, {
      conversationId: "cap-4",
      userText: "続けて",
      character,
      timeoutMs: 300,
    });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(3000);

    const generation = generationOf(store, "cap-4");
    expect(generation.truncated).toBe("deadline");
    expect(generation.status).toBe("aborted");
    expect(generation.rawOutput.startsWith("<action>")).toBe(true);
    expect(generation.latencyMs).toBeGreaterThanOrEqual(250);
    expect(
      events.filter((event) => event.type === "chunk" || event.type === "dropped").length,
    ).toBeGreaterThan(0);
    expect(events[events.length - 1]?.type).toBe("done");
    expect(store.turns.get("cap-4")).toHaveLength(1);
  });

  test("締切までに 1 字も来んかったら error イベントを流し、それでも persist は走る", async () => {
    const store = createMemoryTurnStore();
    const graph = createTurnGraph({ model: new HangingChatModel({}), store });

    const events = await collect(graph, {
      conversationId: "cap-5",
      userText: "続けて",
      character,
      timeoutMs: 200,
    });

    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent).toBeDefined();
    expect(events.filter((event) => event.type === "chunk")).toHaveLength(0);
    expect(events[events.length - 1]?.type).toBe("done");

    const generation = generationOf(store, "cap-5");
    expect(generation.status).toBe("aborted");
    expect(generation.truncated).toBe("deadline");
    expect(generation.rawOutput).toBe("");
    expect(generation.error).toContain("200");
    expect(store.turns.get("cap-5")).toHaveLength(1);
  });
});
