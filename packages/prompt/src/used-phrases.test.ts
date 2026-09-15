import { describe, expect, it } from "vitest";

import { collectUsedPhrases } from "./used-phrases";

describe("collectUsedPhrases", () => {
  it("ターンをまたいで 2 回出た連なりを拾う（鎖骨に歯を立て…血の味）", () => {
    const t7 = "<action>きみの鎖骨に歯を立て、かすかに血の味が舌に広がる。</action>";
    const t10 =
      "<action>きみの鎖骨に歯を立て、新しい痕を残す。血の味が舌に広がり、指が震える。</action>";
    const phrases = collectUsedPhrases([t7, t10]);
    expect(phrases.some((phrase) => phrase.includes("鎖骨に歯を立て"))).toBe(true);
    expect(phrases.some((phrase) => phrase.includes("血の味が舌に広が"))).toBe(true);
  });

  it("共有する連なりが無ければ空", () => {
    expect(
      collectUsedPhrases([
        "<action>窓の外で雨が強くなる。</action>",
        "<action>ココアの湯気が指先を温める。</action>",
      ]),
    ).toEqual([]);
  });

  it("個数は 10 まで、長いものから", () => {
    const base = Array.from({ length: 15 }, (_, i) => `独立した文その${i}がここに置かれとる文章`);
    const first = base.map((s) => `<action>${s}。</action>`).join("");
    const phrases = collectUsedPhrases([first, first]);
    expect(phrases.length).toBeLessThanOrEqual(10);
    expect(phrases.every((phrase) => phrase.length >= 6 && phrase.length <= 24)).toBe(true);
  });
});
