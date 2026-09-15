import { describe, expect, it } from "vitest";

import {
  CROSS_TURN_SPREAD_THRESHOLD,
  countRepeatedPhrasesAcrossTurns,
} from "./vlong-dogfood-recheck";

// production の再掲検出は「前の 1 ターンに対して 2 句以上」で判定する。別々のターンから
// 1 句ずつ引いてくる再掲はそこを通り抜ける。実測 2026-08-20 phase54 Downer-04 が
// t1 から「こんなに濡れてるなんて」、t3 から「きみがここにいるだけで」を逐語で引いとったのに
// 機械では 0 件やった（読解では 20 ターンで一番重い欠陥）。

const turn = (dialogues: readonly string[]): string =>
  `<response>${dialogues.map((d) => `<dialogue>${d}</dialogue>`).join("")}</response>`;

describe("countRepeatedPhrasesAcrossTurns", () => {
  it("別々のターンから 1 句ずつ引いた再掲を合計で拾う", () => {
    const previous = [
      turn(["…でも、ほんと、バカじゃないの。こんなに濡れてるなんて。"]),
      turn(["…絵の道具、好き？"]),
      turn(["きみがここにいるだけで、部屋が少し温かくなる。"]),
    ];
    const current = turn([
      "…きみ、ほんと、バカじゃないの。こんなに濡れてるなんて。",
      "きみがここにいるだけで、なんだか落ち着くよ。",
    ]);

    const result = countRepeatedPhrasesAcrossTurns(current, previous);

    expect(result.total).toBeGreaterThanOrEqual(CROSS_TURN_SPREAD_THRESHOLD);
    expect(result.phrases).toContain("こんなに濡れてるなんて");
    expect(result.phrases).toContain("きみがここにいるだけで");
  });

  it("重ならん本文では 0 件", () => {
    const previous = [turn(["…絵の道具、好き？"])];
    const current = turn(["雨、やんだみたいだね。窓の外が静かになった。"]);

    expect(countRepeatedPhrasesAcrossTurns(current, previous).total).toBe(0);
  });

  it("短い相槌は数えん", () => {
    const previous = [turn(["…まあ、いいけど。"])];
    const current = turn(["…まあ、いいけど。それで、どうするの。"]);

    expect(countRepeatedPhrasesAcrossTurns(current, previous).total).toBe(0);
  });
});
