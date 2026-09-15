// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildSceneStateContinuity } from "../lib/route-context";

import type { ChatMessage } from "../lib/route-context";

// 実測 2026-08-19 phase52: Sakura t9 は climax で相手が「もう限界。全部、中で受け止めて。」と
// 言うたのに、玄関のドアが閉まってソファに座る場面へ巻き戻り、性描写が 0 行やった。
// t7 では既に壁へ押しつけられて服をずらされとる。錨は場所と服装だけを渡しとって、
// 「どこまで進んどるか」を一度も渡しとらんかった。
// 進行度の語は相手の発言に 6/40 ターン、キャラ本文に 29/40 ターン（phase43 + phase52 実測）。

const sheet: ChatMessage = {
  role: "system",
  content: "【キャラクター】桜庭 さくら。【シナリオ】桜並木で声をかけられる。",
};

describe("buildSceneStateContinuity", () => {
  it("進行度がキャラ本文にしか無くても錨へ乗せる", () => {
    const anchor = buildSceneStateContinuity(
      [
        sheet,
        { role: "user", content: "……ここ出ようか。うち、すぐ近くだから。" },
        {
          role: "assistant",
          content:
            "<response><action>スカートがめくれ、奥まで突き上げられて声が漏れる。</action></response>",
        },
        { role: "user", content: "もう限界。全部、中で受け止めて。" },
      ],
      "climax",
    );
    expect(anchor).toContain("arousal=");
  });

  it("相手の発言にある進行度を優先する", () => {
    const anchor = buildSceneStateContinuity(
      [
        sheet,
        {
          role: "assistant",
          content: "<response><action>奥を突き上げられる。</action></response>",
        },
        { role: "user", content: "もう射精しそうだ" },
      ],
      "climax",
    );
    expect(anchor).toContain("arousal=射精");
  });

  it("進行度がどこにも無ければ錨へ足さん", () => {
    const anchor = buildSceneStateContinuity(
      [
        sheet,
        { role: "user", content: "カフェで少し話そう" },
        { role: "assistant", content: "<response><action>紅茶に口をつける。</action></response>" },
      ],
      "intimate",
    );
    expect(anchor).not.toContain("arousal=");
  });
});
