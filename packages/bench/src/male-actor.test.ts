import { FakeListChatModel } from "@langchain/core/utils/testing";
import { describe, expect, it } from "vitest";

import { createMaleActor } from "./male-actor";

const BEAT = {
  intent: "intimate" as const,
  draft: "……ここなら誰にも見られねえよ。ほら、こっち来い",
};

const HISTORY = [
  {
    user: "なあ、そこのきみ。ちょっと話そうよ",
    assistant:
      "<response><action>本を胸に抱えて少し身を引く</action><dialogue>あの……なんでしょうか</dialogue><inner>怖い</inner></response>",
  },
];

describe("male-actor", () => {
  it("cue の無い生成はそのまま通す", async () => {
    const actor = createMaleActor(
      new FakeListChatModel({ responses: ["そんなに怯えるなって。座れよ"] }),
    );
    const line = await actor.nextLine({ beat: BEAT, history: HISTORY });
    expect(line).toEqual({ text: "そんなに怯えるなって。座れよ", regenerated: 0, fallback: false });
  });

  it("disengagement cue を吐いたら書き直しを求める（1回だけ）", async () => {
    const model = new FakeListChatModel({
      responses: ["やめようとしても無駄だ", "怖がるな。ただ話すだけだ"],
    });
    const actor = createMaleActor(model);
    const line = await actor.nextLine({ beat: BEAT, history: HISTORY });
    expect(line).toEqual({ text: "怖がるな。ただ話すだけだ", regenerated: 1, fallback: false });
  });

  it("書き直しても cue が残ったら台本のドラフトにフォールバック", async () => {
    const model = new FakeListChatModel({
      responses: ["待って、落ち着け", "いやいや、そう慌てるな"],
    });
    const actor = createMaleActor(model);
    const line = await actor.nextLine({ beat: BEAT, history: HISTORY });
    expect(line).toEqual({ text: BEAT.draft, regenerated: 1, fallback: true });
  });
});
