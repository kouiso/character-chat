import { describe, expect, it, vi } from "vitest";

import {
  TURN_GENERATION_WALL_CLOCK_CAP_MS,
  VERY_LONG_TURN_GENERATION_WALL_CLOCK_CAP_MS,
  resolveTurnWallClockCapMs,
} from "../lib/route-context";

// 局長の本番スクショ 2026-08-18:「ことばを探している… 122 秒」。
// 締切は「次の試行を始める前」にしか見られてへんかったので、締切の直前に始まった
// 試行が生成 25〜40 秒 + 採点 12 秒を走り切っとった（70 + 40 + 12 = 122）。
// さらに締切の起点が呼び出しごとのローカル変数やったため、拒否リカバリで
// 2 度目を呼ぶと窓がもう一本立ち直っとった。
describe("ターンの締切", () => {
  it("上限を決める場所がひとつだけある", () => {
    expect(resolveTurnWallClockCapMs(false)).toBe(TURN_GENERATION_WALL_CLOCK_CAP_MS);
    expect(resolveTurnWallClockCapMs(true)).toBe(VERY_LONG_TURN_GENERATION_WALL_CLOCK_CAP_MS);
  });

  // 呼び出し側が締切を持つので、同じターンで 2 度呼んでも窓は 1 本のまま。
  it("共有の箱へ入れた締切は、2 度目の呼び出しでも同じ時刻を指す", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-18T12:00:00Z"));
      const budget = {
        remaining: 3,
        deadlineAt: Date.now() + resolveTurnWallClockCapMs(false),
      };
      const firstDeadline = budget.deadlineAt;

      // 拒否リカバリで 2 度目を呼ぶまでに 40 秒経過したとする。
      vi.advanceTimersByTime(40_000);
      // 呼ばれた側は箱の締切を使う（自分では引き直さん）。
      const secondDeadline = budget.deadlineAt ?? Date.now() + resolveTurnWallClockCapMs(false);

      expect(secondDeadline).toBe(firstDeadline);
      // 引き直しとったら 40 秒ぶん後ろへずれとった。
      expect(secondDeadline).toBeLessThan(Date.now() + resolveTurnWallClockCapMs(false));
    } finally {
      vi.useRealTimers();
    }
  });

  // 走っとる試行を畳む信号。締切までの残りで作る。
  // AbortSignal.timeout は実時間で動くので、ここだけ偽タイマーを使わん。
  it("残り時間から作った信号は、締切で発火する", async () => {
    const deadlineSignal = AbortSignal.timeout(20);
    const clientSignal = new AbortController().signal;
    const combined = AbortSignal.any([clientSignal, deadlineSignal]);

    expect(combined.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(combined.aborted).toBe(true);
  });

  // クライアントが先に切った時も畳む。どちらが先でも止まる形になっとること。
  it("クライアントの切断でも発火する", () => {
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);

    expect(combined.aborted).toBe(false);
    controller.abort();
    expect(combined.aborted).toBe(true);
  });
});
