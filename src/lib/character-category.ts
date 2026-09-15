import { visibleCharacterTags } from "./character-display-tag";
import { CHIP_CATEGORIES } from "./character-generator";

/**
 * キャラのタグをカテゴリへ束ねる。
 *
 * 背景(#830): 67キャラのタグは自由記述で、実測 257 種・320 個。さがす画面の
 * 絞り込みは all/official/mine/talked の4つだけで、タグ側の分類が無かった。
 *
 * 語彙の出どころはキャラ作成の `CHIP_CATEGORIES`（types/relations/personalities/
 * bodyTypes）。ただしこれだけでは実タグの 9% しか当たらんかったので、実データで
 * 2回以上出るタグを明示的に足しとる。当たらんタグは無理に分類せず、検索側に残す。
 */

export type CharacterCategoryKey = "types" | "relations" | "personalities" | "looks" | "genres";

export type CharacterCategory = {
  key: CharacterCategoryKey;
  label: string;
  tags: readonly string[];
};

const chipsOf = (key: (typeof CHIP_CATEGORIES)[number]["key"]): readonly string[] =>
  CHIP_CATEGORIES.find((category) => category.key === key)?.chips ?? [];

// CHIP_CATEGORIES に無いが実データに複数回出るタグ。出現頻度で拾っとるので、
// 語彙を増やすときは seed のタグ分布を数え直してから足す。
const EXTRA_TYPES = [
  "清楚ビッチ",
  "大学生",
  "OL",
  "高校3年",
  "筋トレ女子",
  "アンドロイド",
] as const;
const EXTRA_RELATIONS = ["年上", "女上司", "同棲彼女", "既婚", "双子"] as const;
const EXTRA_PERSONALITIES = ["ギャップ", "純粋", "一途", "寂しがり", "葛藤", "発情期"] as const;
const EXTRA_LOOKS = ["眼鏡", "ストッキング"] as const;
const GENRE_TAGS = [
  "ファンタジー",
  "SF",
  "和風",
  "人外",
  "NTR",
  "禁断",
  "背徳感",
  "秘密",
  "言葉攻め",
  "言葉責め",
  "密着",
  "匂いフェチ",
  "オフィス",
] as const;

export const CHARACTER_CATEGORIES: readonly CharacterCategory[] = [
  { key: "types", label: "タイプ", tags: [...chipsOf("types"), ...EXTRA_TYPES] },
  { key: "relations", label: "関係性", tags: [...chipsOf("relations"), ...EXTRA_RELATIONS] },
  {
    key: "personalities",
    label: "性格",
    tags: [...chipsOf("personalities"), ...EXTRA_PERSONALITIES],
  },
  { key: "looks", label: "体型・外見", tags: [...chipsOf("bodyTypes"), ...EXTRA_LOOKS] },
  { key: "genres", label: "シチュ・ジャンル", tags: GENRE_TAGS },
];

const TAG_TO_CATEGORY = new Map<string, CharacterCategoryKey>();
for (const category of CHARACTER_CATEGORIES) {
  for (const tag of category.tags) {
    // 先に登録したカテゴリを優先する。同じ語が複数カテゴリに現れても分類は1つに決める。
    if (!TAG_TO_CATEGORY.has(tag)) TAG_TO_CATEGORY.set(tag, category.key);
  }
}

/** タグ1つの所属カテゴリ。語彙に無ければ null（＝分類しない）。 */
export const categoryOfTag = (tag: string): CharacterCategoryKey | null =>
  TAG_TO_CATEGORY.get(tag.trim()) ?? null;

/** 内部タグを除いたうえで、カテゴリ別にタグを束ねる。空のカテゴリは返さない。 */
export const categorizeCharacterTags = (
  tags: readonly string[] | null | undefined,
): Partial<Record<CharacterCategoryKey, string[]>> => {
  const grouped: Partial<Record<CharacterCategoryKey, string[]>> = {};
  for (const tag of visibleCharacterTags(tags)) {
    const key = categoryOfTag(tag);
    if (!key) continue;
    (grouped[key] ??= []).push(tag);
  }
  return grouped;
};

/** そのキャラが指定タグを持つか。さがす画面の絞り込みで使う。 */
export const characterHasTag = (tags: readonly string[] | null | undefined, tag: string): boolean =>
  visibleCharacterTags(tags).some((candidate) => candidate.trim() === tag.trim());

/**
 * 実際に1体以上のキャラが持っているタグだけを、カテゴリ順に並べて返す。
 * 誰も持っていないタグをチップに出すと、押しても0件で行き止まりになる。
 */
export const availableCategoryTags = (
  characterTags: readonly (readonly string[] | null | undefined)[],
): { category: CharacterCategory; tags: string[] }[] => {
  const present = new Set<string>();
  for (const tags of characterTags) {
    for (const tag of visibleCharacterTags(tags)) present.add(tag.trim());
  }

  return CHARACTER_CATEGORIES.map((category) => ({
    category,
    tags: category.tags.filter((tag) => present.has(tag)),
  })).filter((entry) => entry.tags.length > 0);
};
