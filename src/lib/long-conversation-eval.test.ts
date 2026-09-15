import { describe, expect, it } from "vitest";

import { evaluateLongConversation } from "./long-conversation-eval";

const response = (action: string, dialogue: string, inner: string): string =>
  `<response><action>${action}</action><dialogue>${dialogue}</dialogue><inner>${inner}</inner></response>`;

describe("evaluateLongConversation", () => {
  it("30ターンを超える会話の遠距離loop回数とp95を返す", () => {
    const markers = [
      ..."亜伊宇江於加幾久計己左之須世曽多知津天止奈仁奴祢乃波比不辺保末美武女毛也由与良利流礼呂",
    ];
    const turns = Array.from({ length: 32 }, (_, index) => ({
      assistant: response(
        `${markers[index]?.repeat(18)}。`,
        `「${markers[index]?.repeat(16)}」`,
        `${markers[index]?.repeat(20)}。`,
      ),
      latencyMs: (index + 1) * 100,
    }));
    turns[29] = {
      assistant: response(
        `${markers[0]?.repeat(18)}。`,
        `「${markers[0]?.repeat(16)}」`,
        "それでも今の気持ちは少し変わり、遠くの街明かりへ新しい願いを託している。",
      ),
      latencyMs: 9_000,
    };

    expect(evaluateLongConversation(turns)).toEqual({
      turnCount: 32,
      repetitionLoopOccurrences: 1,
      repeatedTurnIndexes: [30],
      p95LatencyMs: 3_200,
    });
  });
});
