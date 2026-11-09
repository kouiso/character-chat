import { describe, expect, it } from "vitest";

import { runMemoryAdversarialCheck } from "./memory-adversarial-check";

// RIT-101: 各いじわる試験が本物の機構で通り、機構を外した版では赤になること。
describe("memory adversarial check", () => {
  it("4種の試験が全て通り、わざと失敗する版は全て赤になる", async () => {
    const report = await runMemoryAdversarialCheck();
    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(4);
    expect(report.sabotage).toHaveLength(4);
    for (const check of report.checks) expect(check.pass, check.name).toBe(true);
    for (const check of report.sabotage) expect(check.pass, check.name).toBe(false);
  }, 120_000);
});
