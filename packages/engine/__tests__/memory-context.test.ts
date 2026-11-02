import { FakeListChatModel } from "@langchain/core/utils/testing";

import { createTurnGraph, runTurn } from "../src/graph";
import { MEMORY_CONTEXT_CHARACTERS, withMemoryContext } from "../src/memory-context";
import { createMemoryTurnStore } from "../src/memory-store";

describe("保存した記憶の文脈", () => {
  it("空と過長な記憶を除き、元の会話と上限を守る", () => {
    const messages = [{ role: "user" as const, content: "こんにちは" }];
    expect(withMemoryContext(messages, [])).toBe(messages);
    const result = withMemoryContext(messages, ["", "x".repeat(2_001), "集合は駅前"]);
    expect(result[0]).toEqual({
      role: "user",
      content: JSON.stringify({ savedMemories: ["集合は駅前"] }),
    });
    expect(result[0].content.length).toBeLessThanOrEqual(MEMORY_CONTEXT_CHARACTERS);
    expect(result.slice(1)).toEqual(messages);
  });

  it("毎ターン読み直し、編集と削除を次のモデル入力へ反映する", async () => {
    const store = createMemoryTurnStore();
    let memories = ["待ち合わせは駅前"];
    const readMemories = jest.fn(async () => memories);
    const graph = createTurnGraph({
      store,
      readMemories,
      extendBelowRatio: 0,
      model: new FakeListChatModel({
        responses: [
          "<response><action>地図を広げる</action><dialogue>近くに公園がありますよ</dialogue><inner>道を確認しよう</inner></response>",
          "<response><action>時計を見上げる</action><dialogue>今は午後の三時ですね</dialogue><inner>時間には余裕がある</inner></response>",
          "<response><action>手帳を閉じる</action><dialogue>帰りは電車にしましょう</dialogue><inner>切符を用意しておこう</inner></response>",
        ],
      }),
    });
    const character = {
      id: "test",
      name: "案内係",
      greeting: "こんにちは",
      systemPrompt: "丁寧に案内する成人です。",
    };
    const requests: string[] = [];
    for (const value of [["待ち合わせは駅前"], ["待ち合わせは図書館"], []]) {
      memories = value;
      for await (const event of runTurn(
        graph,
        { conversationId: "memory-conv", character, userText: "予定は？" },
        "memory-conv",
      )) {
        if (event.type === "error") throw new Error(event.message);
      }
      const saved = store.turns.get("memory-conv")?.at(-1);
      const generation = saved?.events.find((event) => event.type === "generation");
      requests.push(JSON.stringify(generation?.request));
    }
    expect(readMemories).toHaveBeenCalledTimes(3);
    expect(requests[0]).toContain("待ち合わせは駅前");
    expect(requests[1]).toContain("待ち合わせは図書館");
    expect(requests[1]).not.toContain("待ち合わせは駅前");
    expect(requests[2]).not.toContain("savedMemories");
  });
});
