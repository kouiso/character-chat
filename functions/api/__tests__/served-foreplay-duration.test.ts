import { describe, expect, it } from "vitest";

import { countTrailingForeplayTurns } from "../lib/route-context";

// A5「まだ胸の段やのに手マンに入る」は前ターンの配信フェーズを**引き金**に使ったのが機構やった。
// ここで使うのは引き金やのうて**継続時間**——2 ターン続いて初めて門が開く。
// 実測(2026-08-18 phase23 霜月鈴): 配信は t5/t6 が intimate、t7 の時点で 2 ターン続く。
describe("countTrailingForeplayTurns", () => {
  it("直近から intimate が続いとる分だけ数える", () => {
    expect(countTrailingForeplayTurns(["intimate", "intimate", "conversation"])).toBe(2);
  });

  it("直近が intimate やなければ 0", () => {
    expect(countTrailingForeplayTurns(["conversation", "intimate", "intimate"])).toBe(0);
  });

  it("erotic まで進んどったら前戯の継続としては数えん", () => {
    expect(countTrailingForeplayTurns(["erotic", "intimate", "intimate"])).toBe(0);
  });

  it("空なら 0", () => {
    expect(countTrailingForeplayTurns([])).toBe(0);
  });
});
