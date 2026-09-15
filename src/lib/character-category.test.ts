import { describe, expect, it } from "vitest";

import {
  availableCategoryTags,
  categorizeCharacterTags,
  categoryOfTag,
  characterHasTag,
  CHARACTER_CATEGORIES,
} from "./character-category";

describe("categoryOfTag", () => {
  it("キャラ作成の語彙からカテゴリを引ける", () => {
    expect(categoryOfTag("ツンデレ")).toBe("personalities");
    expect(categoryOfTag("幼馴染")).toBe("relations");
    expect(categoryOfTag("巨乳")).toBe("looks");
    expect(categoryOfTag("お嬢様")).toBe("types");
  });

  it("実データ由来の追加語彙も引ける", () => {
    expect(categoryOfTag("NTR")).toBe("genres");
    expect(categoryOfTag("眼鏡")).toBe("looks");
    expect(categoryOfTag("年上")).toBe("relations");
  });

  it("語彙に無いタグは分類しない", () => {
    expect(categoryOfTag("バーテンダー")).toBeNull();
  });

  it("前後の空白を無視する", () => {
    expect(categoryOfTag("  ツンデレ  ")).toBe("personalities");
  });
});

describe("categorizeCharacterTags", () => {
  it("カテゴリ別に束ねる", () => {
    expect(categorizeCharacterTags(["ツンデレ", "後輩", "眼鏡"])).toEqual({
      personalities: ["ツンデレ"],
      relations: ["後輩"],
      looks: ["眼鏡"],
    });
  });

  it("内部タグは分類にも出さない", () => {
    // imported / charap は取り込み記録であってキャラの気配ではない（#920）
    expect(categorizeCharacterTags(["imported", "charap", "ツンデレ"])).toEqual({
      personalities: ["ツンデレ"],
    });
  });

  it("語彙に無いタグしか無ければ空を返す", () => {
    expect(categorizeCharacterTags(["バーテンダー", "甘え上手"])).toEqual({});
  });

  it("null / undefined を受け取っても落ちない", () => {
    expect(categorizeCharacterTags(null)).toEqual({});
    expect(categorizeCharacterTags(undefined)).toEqual({});
  });
});

describe("characterHasTag", () => {
  it("タグの一致を見る", () => {
    expect(characterHasTag(["ツンデレ", "後輩"], "後輩")).toBe(true);
    expect(characterHasTag(["ツンデレ", "後輩"], "先輩")).toBe(false);
  });

  it("内部タグでは一致しない", () => {
    expect(characterHasTag(["imported"], "imported")).toBe(false);
  });
});

describe("availableCategoryTags", () => {
  it("誰も持っていないタグはチップに出さない", () => {
    // 出すと押しても0件で行き止まりになる
    const groups = availableCategoryTags([["ツンデレ"], ["後輩", "ツンデレ"]]);

    expect(groups.map((group) => group.category.key)).toEqual(["relations", "personalities"]);
    expect(groups.find((group) => group.category.key === "personalities")?.tags).toEqual([
      "ツンデレ",
    ]);
    expect(groups.find((group) => group.category.key === "relations")?.tags).toEqual(["後輩"]);
  });

  it("該当が1件も無ければ空配列", () => {
    expect(availableCategoryTags([["バーテンダー"]])).toEqual([]);
  });

  it("カテゴリの並びは定義順を保つ", () => {
    const groups = availableCategoryTags([["お嬢様", "後輩", "ツンデレ", "巨乳", "NTR"]]);

    expect(groups.map((group) => group.category.key)).toEqual(
      CHARACTER_CATEGORIES.map((category) => category.key),
    );
  });
});
