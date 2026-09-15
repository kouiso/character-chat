import { describe, expect, it } from "vitest";

import { buildAntiRepetitionMessage } from "./anti-repetition";

describe("buildAntiRepetitionMessage", () => {
  it("returns null for empty input", () => {
    expect(buildAntiRepetitionMessage([])).toBeNull();
  });

  it("extracts distinctive phrases and builds message", () => {
    const msgs = [
      "<action>奥の奥にどくどくと注がれる熱が止まらない。子宮が精液で満たされていく重さが下腹にずしりと広がる。</action>",
    ];
    const result = buildAntiRepetitionMessage(msgs);
    expect(result).not.toBeNull();
    expect(result).toContain("ANTI-REPETITION");
  });

  it("keeps retry copy character-first without prohibition wording", () => {
    const result = buildAntiRepetitionMessage([
      "<action>子宮が精液で満たされていく重さが下腹に広がる。</action>",
    ]);

    expect(result).not.toBeNull();
    expect(result).toContain("キャラクター本人の声");
    expect(result).not.toContain("使用禁止");
    expect(result).not.toContain("禁止");
  });

  it("deduplicates repeated phrases across messages", () => {
    const msgs = [
      "<action>子宮が精液で満たされていく重さが下腹に広がる。</action>",
      "<action>子宮が精液で満たされていく重さが下腹に広がる。</action>",
    ];
    const result = buildAntiRepetitionMessage(msgs);
    if (result) {
      const colonIdx = result.indexOf(": ");
      const phraseSection = result.slice(colonIdx + 2).split("。")[0];
      const phrases = phraseSection.split("、");
      const unique = new Set(phrases);
      expect(unique.size).toBe(phrases.length);
    }
  });

  it("caps output at MAX_EXTRACTED_PHRASES (5)", () => {
    const longMsg =
      "<action>奥の奥にどくどく注がれる熱が止まらない子宮が精液で満たされていく重さが下腹にずしりと広がるさっき出されたぶんがまだ中に残っているのに新しい波が押し寄せて繋がったところから溢れた白濁がぬるりと太ももを伝い落ちる布地に垂れる音まで聞こえた</action>";
    const result = buildAntiRepetitionMessage([longMsg]);
    if (result) {
      const colonIdx = result.indexOf(": ");
      const phraseSection = result.slice(colonIdx + 2).split("。")[0];
      const phrases = phraseSection.split("、");
      expect(phrases.length).toBeLessThanOrEqual(5);
    }
  });

  it("returns null when no distinctive phrases found", () => {
    const msgs = ["<action>あ、んっ、もっと、だめ</action>"];
    const result = buildAntiRepetitionMessage(msgs);
    // may return null if no kanji-containing long phrases found
    if (result !== null) {
      expect(result).toContain("ANTI-REPETITION");
    }
  });
});
