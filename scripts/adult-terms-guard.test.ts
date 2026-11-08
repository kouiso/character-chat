// @vitest-environment node
import { describe, expect, it } from "vitest";

import { findViolations, loadTerms, scanFiles } from "./adult-terms-guard.mjs";

describe("adult-terms-guard (RIT-93)", () => {
  it("拒否語を含むファイルを検出する", () => {
    const hits = scanFiles([{ path: "doc/x.md", content: "本文に中出しが混入" }], ["中出し"]);
    expect(hits["doc/x.md"]["中出し"]).toBe(1);
  });

  it("baseline 内の既存ヒットは通し、増えた分だけ止める", () => {
    const hits = {
      "old.md": { 中出し: 2 },
      "new.md": { フェラ: 1 },
    };
    const baseline = { "old.md": { 中出し: 2 } };
    expect(findViolations(hits, baseline)).toEqual([
      { path: "new.md", term: "フェラ", count: 1, allowed: 0 },
    ]);
  });

  it("baseline より増えた場合も既存ファイルでも止める", () => {
    const hits = { "old.md": { 中出し: 3 } };
    const baseline = { "old.md": { 中出し: 2 } };
    expect(findViolations(hits, baseline)).toHaveLength(1);
  });

  it("英語は大小文字を区別せん", () => {
    const hits = scanFiles([{ path: "a.txt", content: "Creampie CREAMPIE" }], ["creampie"]);
    expect(hits["a.txt"]["creampie"]).toBe(2);
  });

  it("語一覧はコメントと空行を除いて読む", () => {
    expect(loadTerms("# コメント\n中出し\n\nフェラ\n")).toEqual(["中出し", "フェラ"]);
  });
});
