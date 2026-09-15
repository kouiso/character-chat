import { describe, expect, it } from "vitest";

import {
  TURN_GENERATION_WALL_CLOCK_CAP_MS,
  VERY_LONG_TURN_GENERATION_WALL_CLOCK_CAP_MS,
  resolveTurnWallClockCapMs,
} from "../lib/route-context";

// 続き書きは 1 回目 25〜35 秒 + 2 回目 30〜40 秒。70 秒では 2 回目が切られる、という
// 理由で 85 秒の余裕を付けたのに、条件が「ユーザーが たっぷり を選んだか」やった。
// 続き書き自体は出荷既定(medium)でも走るようになっとる（`cdf12d4`）ので、
// 実測 phase60 で Sakura t9 が 610 字の続きを用意した直後に締切へ当たって 525 字で配られた。
describe("ターンの締切", () => {
  it("フロアを強制しとる段は、続き書きの分の余裕を持つ", () => {
    expect(resolveTurnWallClockCapMs(false, 820)).toBe(VERY_LONG_TURN_GENERATION_WALL_CLOCK_CAP_MS);
  });

  it("フロアが無い段は今までどおり", () => {
    expect(resolveTurnWallClockCapMs(false, 0)).toBe(TURN_GENERATION_WALL_CLOCK_CAP_MS);
    expect(resolveTurnWallClockCapMs(false)).toBe(TURN_GENERATION_WALL_CLOCK_CAP_MS);
  });

  it("very_long は今までどおり余裕を持つ", () => {
    expect(resolveTurnWallClockCapMs(true)).toBe(VERY_LONG_TURN_GENERATION_WALL_CLOCK_CAP_MS);
  });
});
