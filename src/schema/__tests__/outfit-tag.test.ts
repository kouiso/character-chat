import { describe, expect, it } from "vitest";

import {
  MAX_OUTFIT_TAGS,
  normalizeOutfitTag,
  OUTFIT_TAG_ENUM,
  sanitizeOutfitTags,
} from "../outfit-tag";
import { OUTFIT_TAG_POST_COUNT } from "../outfit-tag-vocabulary.generated";

describe("normalizeOutfitTag", () => {
  it("#923 の原因になった casual_top を弾く（danbooru に top も casual_top も無い）", () => {
    expect(normalizeOutfitTag("casual_top")).toEqual({ ok: false, reason: "unknown_head" });
  });

  it("末尾が未知でも語彙内の語が残っとれば、その語を主辞に採る", () => {
    expect(normalizeOutfitTag("kimono_style_top")).toEqual({ ok: true, tag: "kimono" });
    expect(normalizeOutfitTag("lace_headpiece")).toEqual({ ok: true, tag: "lace" });
  });

  it.each([
    "red_accents",
    "trendy_accessories",
    "worn_simple_outfit",
    "manager_outfit",
    "glowing_tech_panels",
    "high-collar_uniform",
    "battle_worn",
    "athletic_top",
    "dark_casual_top",
  ])("語彙に一語も無い造語 %s を弾く", (value) => {
    expect(normalizeOutfitTag(value).ok).toBe(false);
  });

  it.each(["white_shirt", "school_uniform", "kimono", "choker", "pleated_skirt"])(
    "実在タグ %s はそのまま通す",
    (value) => {
      expect(normalizeOutfitTag(value)).toEqual({ ok: true, tag: value });
    },
  );

  it("空白区切りで保存された値を下線表記へ直す", () => {
    expect(normalizeOutfitTag("red ribbon")).toEqual({ ok: true, tag: "red_ribbon" });
    expect(normalizeOutfitTag("turtleneck sweater")).toEqual({
      ok: true,
      tag: "turtleneck_sweater",
    });
  });

  it("壊れた JSON 出力 `_b blouse` を blouse へ戻す", () => {
    expect(normalizeOutfitTag("white_school_b blouse")).toEqual({
      ok: true,
      tag: "white_school_blouse",
    });
  });

  it("語彙に無い修飾語だけ落として主辞を残す", () => {
    expect(normalizeOutfitTag("dark_university_style_blazer")).toEqual({
      ok: true,
      tag: "dark_blazer",
    });
    expect(normalizeOutfitTag("navy_academy_cardigan")).toEqual({ ok: true, tag: "cardigan" });
  });

  it("別名を danbooru の正式タグへ寄せる", () => {
    expect(normalizeOutfitTag("sailor_uniform")).toEqual({ ok: true, tag: "serafuku" });
    expect(normalizeOutfitTag("ear_piercings")).toEqual({ ok: true, tag: "ear_piercing" });
    expect(normalizeOutfitTag("cardigans")).toEqual({ ok: true, tag: "cardigan" });
    expect(normalizeOutfitTag("mini_skirt")).toEqual({ ok: true, tag: "miniskirt" });
  });

  it("空文字・記号だけの値を弾く", () => {
    expect(normalizeOutfitTag("   ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeOutfitTag("!!!")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("sanitizeOutfitTags", () => {
  it("未知語を落として理由を返す", () => {
    const result = sanitizeOutfitTags(["tactical_straps", "choker", "ear_piercings"]);
    expect(result.accepted).toEqual(["choker", "ear_piercing"]);
    expect(result.rejected).toEqual([{ raw: "tactical_straps", reason: "unknown_head" }]);
  });

  it("#923 のキャラの登録値から、絵に出せん casual_top だけが消える", () => {
    expect(sanitizeOutfitTags(["casual_top", "choker", "ear_piercings"]).accepted).toEqual([
      "choker",
      "ear_piercing",
    ]);
  });

  it("正規化後に重複した語をまとめる", () => {
    expect(sanitizeOutfitTags(["skirt", "skirts", "skirt"]).accepted).toEqual(["skirt"]);
  });

  it("上限を超えた分を切る", () => {
    const many = Array.from({ length: MAX_OUTFIT_TAGS + 5 }, (_, i) => OUTFIT_TAG_ENUM[i]);
    expect(sanitizeOutfitTags(many).accepted).toHaveLength(MAX_OUTFIT_TAGS);
  });
});

describe("OUTFIT_TAG_ENUM", () => {
  it("全ての語が自分自身へ正規化される（enum の値が保存で弾かれん）", () => {
    for (const tag of OUTFIT_TAG_ENUM) {
      expect(normalizeOutfitTag(tag)).toEqual({ ok: true, tag });
    }
  });

  it("語彙は danbooru の投稿数を根拠として持つ", () => {
    for (const tag of OUTFIT_TAG_ENUM) {
      expect(OUTFIT_TAG_POST_COUNT[tag]).toBeGreaterThan(0);
    }
  });
});
