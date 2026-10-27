import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { FallbackChatModel, FallbackModelError } from "../src/fallback-model";
import { createTurnGraph, runTurn } from "../src/graph";
import { createMemoryTurnStore } from "../src/memory-store";

import type { TurnModelCallOptions } from "../src/graph";
import type { ChatResult } from "@langchain/core/outputs";
import type { ModelAttempt } from "@v2/db";

const attempts: ModelAttempt[] = [
  {
    route: "primary",
    requestedModel: "synthetic/primary",
    model: null,
    provider: null,
    status: "failed",
    reason: "server-error",
    latencyMs: 1,
    timeoutMs: 100,
  },
  {
    route: "fallback-1",
    requestedModel: "synthetic/fallback",
    model: "synthetic/actual",
    provider: "Synthetic",
    status: "ok",
    reason: null,
    latencyMs: 2,
    timeoutMs: 100,
  },
];

class AuditModel extends BaseChatModel<TurnModelCallOptions> {
  private readonly raw: string;
  constructor(raw: string) {
    super({});
    this.raw = raw;
  }
  _llmType(): string {
    return "synthetic-audit";
  }
  async _generate(): Promise<ChatResult> {
    const message = new AIMessageChunk({
      content: this.raw,
      response_metadata: { fallbackAttempts: attempts },
    });
    return { generations: [{ message, text: this.raw }] };
  }
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    const message = new AIMessageChunk({
      content: this.raw,
      response_metadata: { fallbackAttempts: attempts },
    });
    yield new ChatGenerationChunk({ message, text: this.raw });
  }
}

const character = {
  id: "synthetic",
  name: "Fixture",
  systemPrompt: "一人称: わたし\n二人称: あなた",
  greeting: "Hello",
};

describe("model route audit through graph persistence", () => {
  it.each(["generate", "extend", "regenerate"] as const)(
    "does not commit or emit done when %s audit outlives the graph deadline",
    async (purpose) => {
      const raw =
        purpose === "regenerate"
          ? "<dialogue>合成の不正タグ"
          : "<response><dialogue>わたしは合成の手順を確認します。</dialogue></response>";
      const make = () => new FakeListChatModel({ responses: [raw] });
      const delayedAttempt = purpose === "generate" ? 1 : 2;
      let attempted = 0;
      const model = new FallbackChatModel([make(), make(), make()], {
        attemptTimeoutMs: 1000,
        maxOutputChars: 2000,
        isRefusal: () => false,
        onAttempt: async () => {
          attempted++;
          if (attempted !== delayedAttempt) return;
          await new Promise((resolve) => setTimeout(resolve, 40));
          throw new Error("synthetic-audit-storage-failure");
        },
      });
      const store = createMemoryTurnStore();
      const graph = createTurnGraph({
        model,
        store,
        ...(purpose === "extend" ? {} : { extendBelowRatio: 0 }),
      });
      const events: string[] = [];
      const consume = async () => {
        for await (const event of runTurn(
          graph,
          { conversationId: "cancelled-audit", userText: "合成の確認", character, timeoutMs: 10 },
          "cancelled-audit",
        ))
          events.push(event.type);
      };
      await expect(consume()).rejects.toBeInstanceOf(FallbackModelError);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(attempted).toBe(delayedAttempt);
      expect(events).not.toContain("done");
      expect(store.turns.size).toBe(0);
    },
  );
  it("records failed and selected routes, identities and timeout values with the saved generation", async () => {
    const store = createMemoryTurnStore();
    const graph = createTurnGraph({
      model: new AuditModel(
        "<response><dialogue>わたしは合成資料の確認を終えました。</dialogue></response>",
      ),
      store,
      extendBelowRatio: 0,
    });
    for await (const event of runTurn(
      graph,
      { conversationId: "audit", userText: "合成の確認", character },
      "audit",
    )) {
      expect(event.type).not.toBe("generation");
    }
    const generation = store.turns
      .get("audit")?.[0]
      .events.find((event) => event.type === "generation");
    expect(generation).toMatchObject({
      model: "synthetic/actual",
      modelCalls: [{ purpose: "generate", attempts }],
    });
  });

  it("keeps initial and extension call audits separately within one saved generation", async () => {
    const store = createMemoryTurnStore();
    const graph = createTurnGraph({
      model: new AuditModel("<dialogue>わたしは合成の確認を進めます。</dialogue>"),
      store,
    });
    for await (const event of runTurn(
      graph,
      { conversationId: "extension", userText: "合成の確認", character },
      "extension",
    )) {
      expect(event.type).not.toBe("generation");
    }
    const generation = store.turns
      .get("extension")?.[0]
      .events.find((event) => event.type === "generation");
    expect(generation?.modelCalls?.map((call) => call.purpose).slice(0, 2)).toEqual([
      "generate",
      "extend",
    ]);
    expect(generation?.modelCalls?.every((call) => call.attempts.length === 2)).toBe(true);
    expect(generation?.modelCalls?.length).toBeLessThanOrEqual(5);
  });
});
