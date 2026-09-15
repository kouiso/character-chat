import { describe, expect, it } from "vitest";

import {
  MAX_TOTAL_GENERATION_MS,
  outputDirName,
  stopReasonAfter,
  TURN_TIMEOUT_MS,
  turnTimeoutMs,
} from "./script-run-policy";

describe("outputDirName", () => {
  it("同じ日・同じ arm・同じ run でも runId が違えば別ディレクトリになる", () => {
    const a = outputDirName({ date: "2026-09-04", arm: "v2", run: "1", runId: "24313278" });
    const b = outputDirName({ date: "2026-09-04", arm: "v2", run: "1", runId: "89426095" });
    expect(a).toBe("2026-09-04-v2-1-24313278");
    expect(b).toBe("2026-09-04-v2-1-89426095");
    expect(a).not.toBe(b);
  });
});

describe("turnTimeoutMs", () => {
  it("予算が十分なら 1 ターンの締切そのもの", () => {
    expect(turnTimeoutMs(0)).toBe(TURN_TIMEOUT_MS);
    expect(turnTimeoutMs(MAX_TOTAL_GENERATION_MS - TURN_TIMEOUT_MS)).toBe(TURN_TIMEOUT_MS);
  });

  it("残り予算が締切より短ければ残り分だけ渡す（予算はターンの途中でも効く）", () => {
    expect(turnTimeoutMs(MAX_TOTAL_GENERATION_MS - 30_000)).toBe(30_000);
  });

  it("予算を使い切っとっても 0 や負を渡さん", () => {
    expect(turnTimeoutMs(MAX_TOTAL_GENERATION_MS + 1)).toBe(1);
  });
});

describe("stopReasonAfter", () => {
  it("通常のターンでは止めん", () => {
    expect(stopReasonAfter(["ok"])).toBeNull();
    expect(stopReasonAfter(["chars", "ok"])).toBeNull();
  });

  it("締切で切れたターンの直後に止める（理由に deadline が入る）", () => {
    expect(stopReasonAfter(["ok", "deadline"])).toContain("deadline");
    expect(stopReasonAfter(["deadline"])).toContain("deadline");
  });

  it("字数上限は 1 回では止めず、2 ターン続いたら止める", () => {
    expect(stopReasonAfter(["chars"])).toBeNull();
    expect(stopReasonAfter(["ok", "chars"])).toBeNull();
    expect(stopReasonAfter(["chars", "chars"])).toContain("chars");
    expect(stopReasonAfter(["chars", "ok", "chars"])).toBeNull();
  });
});
