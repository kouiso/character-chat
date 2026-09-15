import { describe, expect, it } from "vitest";

import { hasSustainedForeplay } from "../scene-phase";

// 局長 2026-08-17「まだ胸の段やのに手マンに入る」/「1チャットで勝手に話の展開が進んでませんかね？」
// キーワード経路の intimate→erotic 昇格（shouldProactivelyEscalateToErotic）は前戯が
// 2 ターン続いたことを条件にしとるのに、LLM の問い直し経路には同じ門が無かった。
// 両方から同じ門を使えるようにした述語。
describe("hasSustainedForeplay", () => {
  it("前戯が 1 ターン目だけなら成立せん", () => {
    expect(
      hasSustainedForeplay([{ role: "user", content: "……近いね。少しだけ、手に触れてもいい？" }]),
    ).toBe(false);
  });

  it("前戯が 2 ターン続いたら成立する", () => {
    expect(
      hasSustainedForeplay([
        { role: "user", content: "……近いね。少しだけ、手に触れてもいい？" },
        { role: "assistant", content: "指先が触れて、身じろぎする。" },
        { role: "user", content: "髪、かかってる。耳にかけるね。首筋、少し赤くなってる。" },
      ]),
    ).toBe(true);
  });

  it("平場の会話だけでは成立せん", () => {
    expect(
      hasSustainedForeplay([
        { role: "user", content: "さっきは急に声かけてごめん。" },
        { role: "assistant", content: "気にしてません。" },
        { role: "user", content: "普段って、どんな本読むの" },
      ]),
    ).toBe(false);
  });

  // 余韻でシーンが切れたら前戯の連続も切れる。切れんかったら 2 回目の場面が
  // 1 ターン目から erotic を名乗れてまう。
  it("余韻でシーンがリセットされたら数え直す", () => {
    expect(
      hasSustainedForeplay([
        { role: "user", content: "……近いね。少しだけ、手に触れてもいい？" },
        { role: "assistant", content: "指先が触れて、身じろぎする。" },
        { role: "user", content: "髪、かかってる。耳にかけるね。首筋、少し赤くなってる。" },
        { role: "assistant", content: "……もう息が整わへん。全部終わって、脱力してもうた。" },
        { role: "user", content: "また、唇に触れてもいい？" },
      ]),
    ).toBe(false);
  });
});
