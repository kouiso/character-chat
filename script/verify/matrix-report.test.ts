import { describe, expect, it } from "vitest";

import { LENGTH_ORDER, indexCellsByFilename, isStrictlyIncreasing, median } from "./matrix-report";

describe("median", () => {
  // 2026-08-18 に手計算で n=2 と n=34 の中央値を 2 回間違えた。偶数個は平均を取る。
  it("偶数個は真ん中 2 つの平均を取る", () => {
    expect(median([258, 290])).toBe(274);
    expect(median([1, 2, 3, 4])).toBe(3);
  });

  it("奇数個は真ん中をそのまま返す", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("空なら 0", () => {
    expect(median([])).toBe(0);
  });
});

describe("isStrictlyIncreasing", () => {
  it("等しい値が挟まったら単調やない", () => {
    expect(isStrictlyIncreasing([1, 2, 2, 3])).toBe(false);
  });

  it("欠けた段があったら単調と言わん", () => {
    expect(isStrictlyIncreasing([1, undefined, 3, 4])).toBe(false);
  });

  it("厳密に増えとれば true", () => {
    expect(isStrictlyIncreasing([224, 382, 1045, 1888])).toBe(true);
  });
});

describe("indexCellsByFilename", () => {
  it("段と熱量はファイル名からしか取れんので、そこから引く", () => {
    const map = indexCellsByFilename([
      "Sakura-24-matrix-erotic-very_long-long-matrix02-deepseek_deepseek-chat-68084447.txt",
      "Downer-01-matrix-conversation-short-short-matrix02-qwen_qwen-2.5-72b-instruct-68084447.txt",
      "summary-matrix-matrix02-68084447.json",
    ]);
    expect(map.get("Sakura#24")).toEqual(["erotic", "very_long", "long"]);
    expect(map.get("Downer#1")).toEqual(["conversation", "short", "short"]);
    expect(map.size).toBe(2);
  });
});

describe("LENGTH_ORDER", () => {
  it("UI の 4 段と同じ並び", () => {
    expect([...LENGTH_ORDER]).toEqual(["short", "medium", "long", "very_long"]);
  });
});
