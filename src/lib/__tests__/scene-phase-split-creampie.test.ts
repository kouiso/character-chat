import { describe, expect, it } from "vitest";

import { detectScenePhase } from "../scene-phase";

// 実測 2026-08-16: 霜月鈴の 10 ターン通しで climax へ一度も上がらんかった。
// 台本の絶頂ターンは「……出る。全部きみの中に。」で、climax の語は全部
// 「中に」の直後へ 出/だ/イ が続く形（中に出/中にだ/中でイ）しか持っとらんかった。
// 宣言が先、行き先が後という言い方が丸ごと抜けとった。文字列を足し続けても
// 語順の組み合わせは尽きんので、射精の語と行き先の共起で判定する。

const erotic = [
  { role: "user", content: "奥まで突いて" },
  { role: "assistant", content: "腰が跳ねる。" },
];

const phaseOf = (userText: string) =>
  detectScenePhase([...erotic, { role: "user", content: userText }]);

describe("射精の宣言と行き先が離れとる形", () => {
  it.each(["……出る。全部きみの中に。", "もう出そう、奥に。", "出すよ、子宮に全部", "中に、出る"])(
    "%s は climax になる",
    (text) => {
      expect(phaseOf(text)).toBe("climax");
    },
  );

  // 片方だけでは発火させん。両方要るという設計そのものを固定する。
  it.each([
    ["行き先だけ", "奥に手を伸ばして"],
    ["宣言だけ", "そろそろ出るね"],
  ])("%s では climax にならん", (_label, text) => {
    expect(phaseOf(text)).not.toBe("climax");
  });

  // 平場の会話まで巻き込まんこと。エロ段階に入っとらん会話では効かせん。
  it("会話フェーズの日常語では climax にならん", () => {
    expect(
      detectScenePhase([{ role: "user", content: "そろそろ家を出るよ。駅の中で待ってて" }]),
    ).not.toBe("climax");
  });
});
