import { describe, expect, it } from "vitest";

import { runBench } from "./run";

describe("runBench", () => {
  it("--fake で 1 ターン回し、3 チャンク全部 ok の集計を返す", async () => {
    const summary = await runBench(["--fake"]);
    expect(summary.tokens).toBeGreaterThan(0);
    expect(summary.chunks).toBe(3);
    expect(summary.ok).toBe(3);
    expect(summary.ng).toBe(0);
    expect(summary.regenerated).toBe(0);
    expect(summary.reasons).toEqual({});
  });

  it("--fake 無しは M0 では未対応として明示的に落ちる", async () => {
    await expect(runBench([])).rejects.toThrow("--fake");
  });
});
