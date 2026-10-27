import { FakeListChatModel } from "@langchain/core/utils/testing";
import { emptyLedger } from "@v2/prompt";

import { createTurnGraph, runTurn } from "../src/graph";

import type { SaveTurnInput, TurnEvent, TurnStore } from "../src/types";

const character = {
  id: "synthetic",
  name: "Fixture",
  systemPrompt: "一人称: わたし\n二人称: あなた",
  greeting: "Hello",
};

const makeStore = (fail = false) => {
  const saved: SaveTurnInput[] = [];
  const store: TurnStore = {
    load: async () => ({ history: [], ledger: emptyLedger(), turn: 1 }),
    saveTurn: async (input) => {
      if (fail) throw new Error("synthetic database failure");
      saved.push(input);
      return {
        conversationId: input.conversationId,
        turn: input.turn,
        generationId:
          input.events.find((event) => event.type === "generation")?.generationId ?? null,
        serverNow: 1_800_000_000_000,
        chunks: input.events
          .filter((event) => event.type === "chunk")
          .map((event) => ({
            seq: event.seq,
            text: event.text,
            scheduledAt: 1_800_000_000_000 + event.seq * 40,
          })),
      };
    },
  };
  return { saved, store };
};

const collect = async (raw: string, store: TurnStore, events: TurnEvent[]) => {
  const graph = createTurnGraph({
    model: new FakeListChatModel({ responses: [raw] }),
    store,
    extendBelowRatio: 0,
  });
  for await (const event of runTurn(
    graph,
    { conversationId: "synthetic", userText: "fixture", character },
    "synthetic",
  ))
    events.push(event);
};

describe("persisted chunk delivery event", () => {
  it("emits the store receipt before done, after accepted chunks have been saved", async () => {
    const { store, saved } = makeStore();
    const events: TurnEvent[] = [];
    await collect(
      "<response><dialogue>わたしは資料を確認しました。</dialogue></response>",
      store,
      events,
    );
    const delivery = events.find((event) => event.type === "delivery");
    expect(saved).toHaveLength(1);
    expect(delivery).toMatchObject({
      conversationId: "synthetic",
      turn: 1,
      serverNow: 1_800_000_000_000,
    });
    expect(delivery?.type === "delivery" && delivery.chunks.length).toBeGreaterThan(0);
    expect(delivery?.type === "delivery" && delivery.generationId).toBe(
      events.find((event) => event.type === "done")?.generationId,
    );
    expect(events.findIndex((event) => event.type === "delivery")).toBeLessThan(
      events.findIndex((event) => event.type === "done"),
    );
  });

  it("keeps final rejection reasons in the same save input and out of deliverable chunks", async () => {
    const { store, saved } = makeStore();
    const events: TurnEvent[] = [];
    await collect("<dialogue>synthetic broken tag", store, events);
    const dropped = events.filter((event) => event.type === "dropped");
    expect(dropped.length).toBeGreaterThan(0);
    expect(saved[0].events.filter((event) => event.type === "dropped")).toEqual(dropped);
    expect(saved[0].events.filter((event) => event.type === "chunk")).toEqual([]);
    expect(events.find((event) => event.type === "delivery")).toMatchObject({ chunks: [] });
  });

  it("does not emit a delivery or done event when persistence fails", async () => {
    const { store } = makeStore(true);
    const events: TurnEvent[] = [];
    await expect(
      collect("<dialogue>わたしは資料を確認しました。</dialogue>", store, events),
    ).rejects.toThrow("synthetic database failure");
    expect(events.some((event) => event.type === "delivery" || event.type === "done")).toBe(false);
  });

  it.each([
    ["<dialogue></dialogue>", "empty"],
    [
      "<action>資料を確認して青い付箋を貼りました。</action><action>資料を確認して青い付箋を貼りました。</action>",
      "repetition",
    ],
  ])("retains the final rejection for %s", async (raw, reason) => {
    const { store, saved } = makeStore();
    await collect(raw, store, []);
    const rejected = saved[0].events.filter((event) => event.type === "dropped");
    expect(rejected.flatMap((event) => event.reasons)).toContain(reason);
  });
});
