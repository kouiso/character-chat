import { describe, expect, it } from "vitest";

import { measureAll } from "./axes";
import { shouldWarnAboutSources } from "./cli";

import type { BenchTurn } from "./corpus";

const turnOf = (source: BenchTurn["source"]): BenchTurn => ({
  source,
  run: "r",
  scenario: `${source}:r/テスト`,
  config: null,
  character: "テスト",
  turn: 1,
  phase: "erotic",
  model: "m",
  rawBody: "<response><dialogue>「あ」</dialogue></response>",
  headerVisibleChars: null,
  latencyMs: null,
  error: null,
  finishReason: null,
  lastUserChars: null,
  afterBrokenContext: false,
  origin: "fixture",
});

describe("source 跨ぎの警告", () => {
  it("source が1つしか無いなら --compare-sources でも出さん", () => {
    // partition の数で判定しとった間、--compare-sources を付けると partition は
    // 必ず1つになるので、単一 source でも「model-ab と混ぜた」と警告しとった
    const single = measureAll([turnOf("vlong-dogfood")]);
    expect(shouldWarnAboutSources(single, true)).toBe(false);
  });

  it("実際に混ざっとる時だけ出す", () => {
    const mixed = measureAll([turnOf("vlong-dogfood"), turnOf("model-ab")]);
    expect(shouldWarnAboutSources(mixed, true)).toBe(true);
    // --compare-sources を付けてへんなら混ざっとらん（分けて出す）ので言わん
    expect(shouldWarnAboutSources(mixed, false)).toBe(false);
  });
});
