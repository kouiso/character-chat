import type { VisualMeta } from "../../../src/schema/character-visual-enums";

// danbooru/Novita タグへのマッピング
export const HAIR_TAG: Record<string, string> = {
  black: "black hair",
  brown: "brown hair",
  blonde: "blonde hair",
  silver: "silver hair",
  white: "white hair",
  blue: "blue hair",
  green: "green hair",
  purple: "purple hair",
  red: "red hair",
  pink: "pink hair",
};

// 他の髪色タグを negative に入れて identity ドリフトを防ぐ
const HAIR_NEGATIVE: Record<string, string[]> = {
  black: ["blonde_hair", "brown_hair", "silver_hair", "pink_hair", "blue_hair", "red_hair"],
  brown: ["blonde_hair", "black_hair", "silver_hair", "pink_hair", "blue_hair"],
  blonde: ["black_hair", "brown_hair", "silver_hair", "pink_hair", "blue_hair"],
  silver: ["black_hair", "brown_hair", "blonde_hair", "pink_hair"],
  white: ["black_hair", "brown_hair", "blonde_hair", "pink_hair", "blue_hair"],
  blue: ["black_hair", "brown_hair", "blonde_hair", "pink_hair", "red_hair"],
  green: ["black_hair", "brown_hair", "blonde_hair", "pink_hair", "red_hair"],
  purple: ["black_hair", "brown_hair", "blonde_hair", "red_hair"],
  red: ["black_hair", "brown_hair", "blonde_hair", "blue_hair", "pink_hair"],
  pink: ["black_hair", "brown_hair", "blonde_hair", "blue_hair", "red_hair"],
};

const HAIR_STYLE_TAG: Record<string, string> = {
  straight: "straight hair",
  wavy: "wavy hair",
  curly: "curly hair",
  bob: "bob cut",
  ponytail: "ponytail",
  twintails: "twintails",
  braid: "braid",
  messy: "messy hair",
};

const HAIR_LENGTH_TAG: Record<string, string> = {
  short: "short hair",
  medium: "medium hair",
  long: "long hair",
  very_long: "very long hair",
};

export const EYE_TAG: Record<string, string> = {
  black: "black eyes",
  brown: "brown eyes",
  blue: "blue eyes",
  green: "green eyes",
  hazel: "hazel eyes",
  grey: "grey eyes",
  amber: "amber eyes",
  red: "red eyes",
  heterochromia: "heterochromia",
};

// 瞳色の negative は直接の競合色のみ
const EYE_NEGATIVE: Record<string, string[]> = {
  black: ["blue_eyes", "red_eyes", "green_eyes"],
  brown: ["blue_eyes", "red_eyes", "green_eyes"],
  blue: ["brown_eyes", "red_eyes", "black_eyes"],
  green: ["blue_eyes", "red_eyes", "brown_eyes"],
  hazel: ["blue_eyes", "red_eyes"],
  grey: ["blue_eyes", "brown_eyes", "red_eyes"],
  amber: ["blue_eyes", "red_eyes"],
  red: ["brown_eyes", "blue_eyes", "green_eyes"],
  heterochromia: [],
};

const SKIN_TAG: Record<string, string> = {
  pale: "pale skin",
  fair: "fair skin",
  olive: "olive skin",
  tanned: "tanned skin",
  dark: "dark skin",
};

export const BODY_TAG: Record<string, string> = {
  petite: "petite",
  slender: "slender",
  average: "average body",
  athletic: "athletic",
  curvy: "curvy",
  voluptuous: "voluptuous",
};

// 体型の反対語を negative に
const BODY_NEGATIVE: Record<string, string[]> = {
  petite: ["fat", "chubby", "voluptuous"],
  slender: ["fat", "chubby", "voluptuous", "curvy"],
  average: ["fat", "extremely thin"],
  athletic: ["fat", "chubby", "flabby"],
  curvy: ["flat chest", "very thin"],
  voluptuous: ["flat chest", "thin", "petite"],
};

const BREAST_TAG: Record<string, string> = {
  flat: "flat chest",
  small: "small breasts",
  medium: "medium breasts",
  large: "large breasts",
  huge: "huge breasts",
};

// 胸サイズの競合タグを negative に
const BREAST_NEGATIVE: Record<string, string[]> = {
  flat: ["large_breasts", "huge_breasts", "big_breasts"],
  small: ["large_breasts", "huge_breasts", "big_breasts", "flat_chest"],
  medium: ["huge_breasts", "flat_chest"],
  large: ["flat_chest", "small_breasts"],
  huge: ["flat_chest", "small_breasts", "medium_breasts"],
};

const HEIGHT_TAG: Record<string, string> = {
  petite: "short stature",
  average: "",
  tall: "tall",
};

export type IdentityPrompt = { positive: string; negative: string };

// positive タグ群（extractVisualAnchors の出力等）から髪色を検出し、
// 競合色を negative に返す。character_visual が無いキャラへのフォールバック用。
export const buildNegativeFromPositive = (positive: string): string => {
  const lower = positive.toLowerCase();
  for (const [key, tag] of Object.entries(HAIR_TAG)) {
    if (lower.includes(tag)) {
      return (HAIR_NEGATIVE[key] ?? []).join(", ");
    }
  }
  return "";
};

// 幼児化した描画を常時打ち消す。年齢指定の有無に関わらず入れる。
const CHILDLIKE_NEGATIVE = [
  "child",
  "toddler",
  "infant",
  "loli",
  "kindergarten",
  "elementary school student",
  "baby face",
  "chibi",
  "deformed proportions",
  "oversized head",
] as const;

// 年齢を絵に効く語へ変える。20歳未満でも成人であることを明示して幼児寄りを避ける。
const buildAgeTags = (ageApparent: number): string[] => {
  const band =
    ageApparent >= 40
      ? "mature woman"
      : ageApparent >= 30
        ? "adult woman in her thirties"
        : ageApparent >= 23
          ? "adult woman in her twenties"
          : "young adult woman";
  return [`${ageApparent} years old`, band, "adult body proportions"];
};

export const buildIdentityPrompt = (meta: VisualMeta): IdentityPrompt => {
  const positiveTags: string[] = [];

  // 髪色は anchor として weight 1.6 で最優先（buildVisualAnchorPrompt 側で処理）
  const hairColorTag = HAIR_TAG[meta.hairColor];
  if (hairColorTag) positiveTags.push(hairColorTag);

  const hairStyleTag = HAIR_STYLE_TAG[meta.hairStyle];
  if (hairStyleTag) positiveTags.push(hairStyleTag);

  const hairLengthTag = HAIR_LENGTH_TAG[meta.hairLength];
  if (hairLengthTag) positiveTags.push(hairLengthTag);

  const eyeTag = EYE_TAG[meta.eyeColor];
  if (eyeTag) positiveTags.push(eyeTag);

  const skinTag = SKIN_TAG[meta.skinTone];
  if (skinTag) positiveTags.push(skinTag);

  const bodyTag = BODY_TAG[meta.bodyType];
  if (bodyTag) positiveTags.push(bodyTag);

  if (meta.breastSize !== null && meta.breastSize !== undefined) {
    const breastTag = BREAST_TAG[meta.breastSize];
    if (breastTag) positiveTags.push(breastTag);
  }

  if (meta.heightBand !== null && meta.heightBand !== undefined) {
    const heightTag = HEIGHT_TAG[meta.heightBand];
    if (heightTag) positiveTags.push(heightTag);
  }

  // ageApparent を絵へ届ける。これが無いと 18 歳指定でも頭身と目の比率が
  // 幼児寄りに振れる（2026-07-26 の実生成 4 枚中 3 枚で発生）。
  positiveTags.push(...buildAgeTags(meta.ageApparent));

  // 特徴的マーク・デフォルト衣装はフリーフォームタグをそのまま追加。
  // アンダースコアは booru 系タグの正規表記なので開かん（`mole_under_eye` 等）。
  positiveTags.push(...meta.distinctiveMarks);
  positiveTags.push(...meta.defaultOutfit);

  const negativeTags: string[] = [];

  // 年齢に関わらず常時。成人向けアプリなので幼児化した絵は出してはならん。
  negativeTags.push(...CHILDLIKE_NEGATIVE);
  negativeTags.push(...(HAIR_NEGATIVE[meta.hairColor] ?? []));
  negativeTags.push(...(EYE_NEGATIVE[meta.eyeColor] ?? []));
  negativeTags.push(...(BODY_NEGATIVE[meta.bodyType] ?? []));

  if (meta.breastSize !== null && meta.breastSize !== undefined) {
    negativeTags.push(...(BREAST_NEGATIVE[meta.breastSize] ?? []));
  }

  return {
    positive: positiveTags.filter(Boolean).join(", "),
    negative: negativeTags.filter(Boolean).join(", "),
  };
};
