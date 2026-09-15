import { describe, expect, it } from "vitest";

import { summarizeLateTurns } from "./late-turn-metrics";

describe("summarizeLateTurns", () => {
  it("turn 22以降だけで反復率とp95を集計する", () => {
    const summary = summarizeLateTurns([
      { turn: 21, nearDuplicate: true, totalMs: 99_000, error: null },
      { turn: 22, nearDuplicate: false, totalMs: 10_000, error: null },
      { turn: 23, nearDuplicate: true, totalMs: 20_000, error: null },
      { turn: 24, nearDuplicate: false, totalMs: 30_000, error: null },
      { turn: 25, nearDuplicate: false, totalMs: 90_000, error: "timeout" },
    ]);

    expect(summary).toEqual({ startTurn: 22, turns: 3, nearDupRate: 1 / 3, p95TotalMs: 30_000 });
  });
});
