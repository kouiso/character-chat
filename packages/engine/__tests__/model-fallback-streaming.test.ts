// 逐次配信を受け取らん呼び出しでは、300 字越えの後に切れた試行も次の候補へ回す（#193）。
import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { createTurnGraph, runTurn } from "../src/graph";
import { createMemoryTurnStore, type MemoryTurnStore } from "../src/memory-store";

import type { CharacterSheet, TurnEvent } from "../src/types";

const VALID_XML =
  "<response><action>ゆっくりと近づいて手を伸ばす</action><dialogue>わたし、ずっと待ってた</dialogue><inner>やっと会えて嬉しい</inner></response>";
const LONG_HEAD = `<response><action>${"静かに歩み寄る".repeat(60)}`;

const character: CharacterSheet = {
  id: "char-1",
  name: "テスト子",
  systemPrompt: "一人称: わたし",
  greeting: "はじめまして",
};

const xmlChunk = (text: string) =>
  new ChatGenerationChunk({ message: new AIMessageChunk({ content: text }), text });

// 300 字を越えるまで流した後、締切まで止まる。
class CutByDeadlineModel extends FakeListChatModel {
  async *_streamResponseChunks(
    _messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): AsyncGenerator<ChatGenerationChunk> {
    yield xmlChunk(LONG_HEAD);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

// 300 字を越えるまで流した後、上流の例外で落ちる。
class CutByErrorModel extends FakeListChatModel {
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    yield xmlChunk(LONG_HEAD);
    throw new Error("502 upstream reset");
  }
}

const drain = async (events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> => {
  const out: TurnEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const generationOf = (store: MemoryTurnStore) => {
  const generation = store.turns.get("conv-cut")?.[0]?.events.find((e) => e.type === "generation");
  if (!generation || generation.type !== "generation") throw new Error("generation イベント無し");
  return generation;
};

const run = async (
  models: { name: string; model: FakeListChatModel }[],
  streamsToCaller: boolean | undefined,
) => {
  const store = createMemoryTurnStore();
  const graph = createTurnGraph({
    model: models[0].model,
    models,
    store,
    extendBelowRatio: 0,
    ...(streamsToCaller === undefined ? {} : { streamsToCaller }),
  });
  const streamed = await drain(
    runTurn(
      graph,
      { conversationId: "conv-cut", userText: "こんにちは", character, timeoutMs: 80 },
      "conv-cut",
    ),
  );
  return { generation: generationOf(store), streamed };
};

const tokenText = (streamed: TurnEvent[]) =>
  streamed
    .filter((e) => e.type === "token")
    .map((e) => e.text)
    .join("");

describe("逐次配信を受け取らん呼び出しの逃げ道（#193）", () => {
  test("1 本目が 300 字越えの後に締切で切れても 2 本目が試され、その本文が採用される", async () => {
    const { generation, streamed } = await run(
      [
        { name: "cut", model: new CutByDeadlineModel({ responses: [] }) },
        { name: "escape1", model: new FakeListChatModel({ responses: [VALID_XML] }) },
      ],
      false,
    );
    expect(generation.model).toBe("escape1");
    expect(generation.rawOutput).toContain("ゆっくりと近づいて手を伸ばす");
    expect(generation.rawOutput).not.toContain("静かに歩み寄る");
    expect(generation.attempts?.map((a) => [a.model, a.outcome])).toEqual([
      ["cut", "timeout"],
      ["escape1", "ok"],
    ]);
    expect(tokenText(streamed)).not.toContain("静かに歩み寄る");
  });

  test("1 本目が 300 字越えの後に例外で落ちても 2 本目が試される", async () => {
    const { generation } = await run(
      [
        { name: "cut", model: new CutByErrorModel({ responses: [] }) },
        { name: "escape1", model: new FakeListChatModel({ responses: [VALID_XML] }) },
      ],
      false,
    );
    expect(generation.model).toBe("escape1");
    expect(generation.attempts?.[0]).toMatchObject({ model: "cut", outcome: "error" });
  });

  test("全候補が途中で切れた時は、最後の候補の部分生成を従来どおり採用する（status・本文は配信を受け取る呼び出しと同じ）", async () => {
    const candidates = () => [
      { name: "cut1", model: new CutByDeadlineModel({ responses: [] }) },
      { name: "cut2", model: new CutByDeadlineModel({ responses: [] }) },
    ];
    const quiet = await run(candidates(), false);
    const streaming = await run(candidates(), true);
    expect(quiet.generation.model).toBe("cut2");
    // 配信を受け取る側は 1 本目で確定する（従来どおり）。受け取らん側は最後の候補の部分生成。
    expect(streaming.generation.model).toBe("cut1");
    expect(quiet.generation.status).toBe(streaming.generation.status);
    expect(quiet.generation.truncated).toBe("deadline");
    expect(quiet.generation.rawOutput).toBe(streaming.generation.rawOutput);
    expect(quiet.generation.rawOutput).toContain("静かに歩み寄る");
  });

  test.each([true, undefined])(
    "配信を受け取る呼び出し（%s）は 300 字越え後に切れても切り替えん",
    async (flag) => {
      const { generation, streamed } = await run(
        [
          { name: "cut", model: new CutByDeadlineModel({ responses: [] }) },
          { name: "escape1", model: new FakeListChatModel({ responses: [VALID_XML] }) },
        ],
        flag,
      );
      expect(generation.model).toBe("cut");
      expect(generation.attempts).toEqual([
        { model: "cut", outcome: "ok", detail: "配信後に締切を迎えた" },
      ]);
      expect(tokenText(streamed)).toContain("静かに歩み寄る");
    },
  );
});
