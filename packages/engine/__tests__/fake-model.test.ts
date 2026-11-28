import { describe, expect, test } from "vitest";

import { FAKE_RESPONSES, fakeModelCandidates, fakeResponsesFromEnv } from "../src/fake-model";
import { createTurnGraph, HISTORY_TURNS_FOR_REPETITION, runTurn } from "../src/graph";
import { createMemoryTurnStore, type MemoryTurnStore } from "../src/memory-store";

import type { CharacterSheet, TurnEvent } from "../src/types";

// 返事に代名詞を入れとらん事まで確かめるため、既定と違う一人称・二人称のシートで回す。
const character: CharacterSheet = {
  id: "char-fake",
  name: "案内役",
  systemPrompt: "一人称: あたし\n二人称: きみ\n図書館の案内役。",
  greeting: "こんにちは。",
};

const collect = async (events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> => {
  const all: TurnEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
};

// engine.ts の startTurn と同じく、ターンごとに固定モデルとグラフを組み直して 1 ターン回す。
// 書き足し（extend）も既定のまま走らせ、実行時と同じ呼び出しの並びにする。
const runFakeTurn = (store: MemoryTurnStore, turn: number, userText: string) => {
  const models = fakeModelCandidates({}, turn);
  const graph = createTurnGraph({ model: models[0].model, models, store });
  return collect(runTurn(graph, { conversationId: "conv-fake", userText, character }, "conv-fake"));
};

describe("V2_FAKE_MODEL の既定の返事", () => {
  test("反復を見る範囲より多くの本数を持ち、どれも別の本文", () => {
    expect(FAKE_RESPONSES.length).toBeGreaterThan(HISTORY_TURNS_FOR_REPETITION);
    expect(new Set(FAKE_RESPONSES).size).toBe(FAKE_RESPONSES.length);
  });

  test("ターン番号で 1 本だけ選び、番号が無い・壊れた時は 1 ターン目の返事", () => {
    expect(fakeResponsesFromEnv({})).toEqual([FAKE_RESPONSES[0]]);
    expect(fakeResponsesFromEnv({}, 1)).toEqual([FAKE_RESPONSES[0]]);
    expect(fakeResponsesFromEnv({}, 2)).toEqual([FAKE_RESPONSES[1]]);
    expect(fakeResponsesFromEnv({}, FAKE_RESPONSES.length + 1)).toEqual([FAKE_RESPONSES[0]]);
    expect(fakeResponsesFromEnv({}, 0)).toEqual([FAKE_RESPONSES[0]]);
    expect(fakeResponsesFromEnv({}, 1.5)).toEqual([FAKE_RESPONSES[0]]);
  });

  test("差し替えの値はターン番号に関わらずそのまま使う", () => {
    expect(fakeResponsesFromEnv({ V2_FAKE_RESPONSE: "固定の返事" }, 3)).toEqual(["固定の返事"]);
    expect(fakeResponsesFromEnv({ V2_FAKE_RESPONSE: '["一つ目","二つ目"]' }, 3)).toEqual([
      "一つ目",
      "二つ目",
    ]);
  });

  // 固定モデルは 1 字ずつ間を空けて流すので、一巡を越えるターン数は既定の 5 秒に収まらん。
  test("ターンごとに組み直しても、一巡を越えて続けた全ターンで返事の塊が配られて保存される", async () => {
    const store = createMemoryTurnStore();
    const turns = FAKE_RESPONSES.length + 2;
    for (let turn = 1; turn <= turns; turn += 1) {
      const events = await runFakeTurn(store, turn, `${turn}番目の質問をします。`);
      const chunks = events.filter((event) => event.type === "chunk");
      expect(chunks.length, `turn ${turn}`).toBeGreaterThan(0);
      expect(
        events.some((event) => event.type === "error"),
        `turn ${turn}`,
      ).toBe(false);
      expect(events.some((event) => event.type === "done")).toBe(true);
    }
    expect(store.turns.get("conv-fake")).toHaveLength(turns);
  }, 60_000);

  test("前のターンと同じ返事は、これまでどおり反復として全部の塊が落ちる", async () => {
    const store = createMemoryTurnStore();
    await runFakeTurn(store, 1, "最初の質問です。");
    // 組み直しの度に同じ返事を返していた修正前の振る舞い。判定を緩めとらん事を確かめる。
    const events = await runFakeTurn(store, 1, "次の質問です。");
    expect(events.filter((event) => event.type === "chunk")).toHaveLength(0);
    const dropped = events.filter((event) => event.type === "dropped");
    expect(dropped.length).toBeGreaterThan(0);
    expect(
      dropped.every((event) => event.type === "dropped" && event.reasons.includes("repetition")),
    ).toBe(true);
  });
});
