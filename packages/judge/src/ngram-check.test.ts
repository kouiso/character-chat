import { describe, expect, it } from "vitest";

import { ngramCheck } from "./ngram-check";

describe("ngramCheck", () => {
  it("フレッシュな段落は通る（新規パラグラフは repetition にならん）", () => {
    const previous = ["<action>彼女が窓の外を見つめている。</action>"];
    const result = ngramCheck("<dialogue>今日はいい天気ね</dialogue>", previous);
    expect(result.ok).toBe(true);
  });

  it("直前の段落と8文字以上のn-gramが3割以上重なると repetition", () => {
    const previous = ["彼女はゆっくりと息を吐きながら目を閉じた。それから静かに囁いた。"];
    const text = "彼女はゆっくりと息を吐きながら目を閉じた。それから静かに呟いた。";
    const result = ngramCheck(text, previous);
    expect(result.ok).toBe(false);
    expect(result.ratio).toBeGreaterThanOrEqual(0.3);
  });

  it("直近20chunkの範囲にある重複も検出する", () => {
    const previous = Array.from({ length: 19 }, (_, i) => `関係ない文章その${i}。`);
    previous.push("激しく求め合う二人の吐息が部屋に響き渡っていた。");
    const text = "激しく求め合う二人の吐息が部屋に響き渡っていた。";
    const result = ngramCheck(text, previous);
    expect(result.ok).toBe(false);
  });

  it("短い台詞でも、直前の塊と丸ごと同じなら ng（2026-09-04 v2 arm: 「…ずっとここにいて」が 1 ターンに 4 回）", () => {
    const previous = ["<dialogue>「…ずっとここにいて」</dialogue>"];
    const result = ngramCheck("<dialogue>ずっとここにいて。</dialogue>", previous);
    expect(result.ok).toBe(false);
    expect(result.exactRepeat).toBe(true);
  });

  it("3 字以下の相槌は丸ごと同じでも ng にせん（「うん」「はい」は場面で自然に繰り返る）", () => {
    const result = ngramCheck("<dialogue>うん</dialogue>", ["<dialogue>うん</dialogue>"]);
    expect(result.ok).toBe(true);
  });

  it("重なった 8 字以上の連なりを matchedPhrases で返す（再生成の依頼文で名指しするため）", () => {
    const previous = ["彼女はゆっくりと息を吐きながら目を閉じた。それから静かに囁いた。"];
    const result = ngramCheck(
      "彼女はゆっくりと息を吐きながら目を閉じた。そして窓を開けた。",
      previous,
    );
    expect(result.ok).toBe(false);
    expect(
      result.matchedPhrases.some((phrase) => phrase.includes("ゆっくりと息を吐きながら")),
    ).toBe(true);
    expect(result.matchedPhrases.length).toBeLessThanOrEqual(6);
  });

  it("16文字の台詞をそのまま繰り返すと repetition になる（旧24文字下限では見逃しとった）", () => {
    const dialogue = "今夜はここに泊まっていってほしい";
    expect(dialogue).toHaveLength(16);
    const result = ngramCheck(dialogue, [dialogue]);
    expect(result.ok).toBe(false);
    expect(result.ratio).toBeGreaterThanOrEqual(0.3);
  });

  it("実質 12 字未満は n-gram の割合では ng にせん（部分一致だけの短い台詞は通す）", () => {
    const result = ngramCheck("<dialogue>うんそうだね</dialogue>", [
      "<dialogue>うんそうかもね</dialogue>",
    ]);
    expect(result.ok).toBe(true);
    expect(result.exactRepeat).toBe(false);
  });
});
