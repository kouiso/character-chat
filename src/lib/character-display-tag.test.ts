import { describe, expect, it } from "vitest";

import { INTERNAL_CHARACTER_TAGS, visibleCharacterTags } from "./character-display-tag";

describe("visibleCharacterTags", () => {
  it("内部タグ imported / charap を落とす", () => {
    expect(visibleCharacterTags(["imported", "charap", "ツンデレ"])).toEqual(["ツンデレ"]);
  });

  it("大文字・前後空白でも内部タグとして落とす", () => {
    expect(visibleCharacterTags([" Imported ", "CHARAP", "巨乳"])).toEqual(["巨乳"]);
  });

  it("内部タグ以外の順序と内容を変えない", () => {
    const tags = ["R18", "saylo", "後輩"];
    expect(visibleCharacterTags(tags)).toEqual(tags);
  });

  it("null / undefined を空配列として扱う", () => {
    expect(visibleCharacterTags(null)).toEqual([]);
    expect(visibleCharacterTags(undefined)).toEqual([]);
  });

  it("内部タグの定義に imported と charap が含まれる", () => {
    expect([...INTERNAL_CHARACTER_TAGS]).toEqual(["imported", "charap"]);
  });
});
