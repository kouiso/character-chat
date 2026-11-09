import { describe, expect, it } from "vitest";

import { runMemoryRecallCheck } from "./memory-recall-check";

describe("memory recall check", () => {
  it("cheat が 100%・記憶なしが 0% になり、実測アームの正答率を記録する", async () => {
    const result = await runMemoryRecallCheck();
    expect(result.cheat).toEqual({ checks: { 50: true, 200: true }, ratio: 1 });
    expect(result.none).toEqual({ checks: { 50: false, 200: false }, ratio: 0 });
    // 類似記憶の競合で古い事実が 200 ターンでは埋もれる。試験が効いとる限り 0〜100% の間。
    expect(result.retrieval.ratio).toBeGreaterThanOrEqual(0);
    expect(result.retrieval.ratio).toBeLessThanOrEqual(1);
    expect(Object.keys(result.retrieval.checks).sort()).toEqual(["200", "50"]);
  }, 120_000);
});
