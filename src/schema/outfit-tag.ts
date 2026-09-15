import {
  DANBOORU_TAG_ALIASES,
  OUTFIT_MODIFIER_POST_COUNT,
  OUTFIT_TAG_POST_COUNT,
} from "./outfit-tag-vocabulary.generated";

/**
 * #923: 衣装タグを「画像モデルが実際に描ける語」に限定する。
 *
 * 本番の `character_default_outfit_tag` は 261 行に対し異なり数 209 で、ほぼ全部が
 * 一度きりの造語やった。取り込み時に LLM へ「danbooru タグで書け」と文章で頼んで
 * おきながら、出力側の検査が `string[]` だけやったのが原因。
 *
 * 通じる語と通じん語を分けとるのは下線か空白かやない。`ear_piercings`（下線あり）は
 * 絵に出て、`casual_top`（下線あり）は出えへんかった。danbooru に `top` というタグは
 * 1 枚も無いので、モデルはその語を絵に結び付けられん。つまり判定軸は
 * 「学習コーパスにその語があるか」だけ。ここではそれを主辞（末尾の語）で見る。
 */

const vocabulary = new Set(Object.keys(OUTFIT_TAG_POST_COUNT));
const modifiers = new Set(Object.keys(OUTFIT_MODIFIER_POST_COUNT));

/**
 * danbooru 側に別名登録が無い言い換えだけを手で足す。
 * 「どの衣装か」を推測する表ではなく、同じ衣装の別表記を正式名へ寄せる表。
 */
const MANUAL_TAG_ALIASES: Readonly<Record<string, string>> = {
  sailor_uniform: "serafuku",
  sailor_fuku: "serafuku",
  cropped_top: "crop_top",
  mini_skirt: "miniskirt",
  ear_piercings: "ear_piercing",
  stockings: "thighhighs",
  qipao: "china_dress",
  tie: "necktie",
  bow_tie: "bowtie",
  heels: "high_heels",
  nightdress: "nightgown",
  swimwear: "swimsuit",
  "cover-up": "swimsuit_cover-up",
  // 帽子の種類までは元の値から決められんので、上位語の hat へ寄せる。
  cap: "hat",
  // LLM の JSON 出力が壊れて `..._b blouse` の形で保存された行がある。
  b_blouse: "blouse",
};

export const MAX_OUTFIT_TAGS = 30;

export type OutfitTagRejection = {
  raw: string;
  /** unknown_head: 主辞が学習コーパスに無い / empty: 正規化したら空になった */
  reason: "unknown_head" | "empty";
};

export type OutfitTagNormalization =
  | { ok: true; tag: string }
  | { ok: false; reason: OutfitTagRejection["reason"] };

const resolveAlias = (token: string): string => {
  const manual = MANUAL_TAG_ALIASES[token];
  if (manual !== undefined) return manual;
  const danbooru = DANBOORU_TAG_ALIASES[token];
  if (danbooru !== undefined) return danbooru;
  // `cardigans` / `skirts` のような単純な複数形だけ単数へ寄せる。
  if (token.endsWith("s")) {
    const singular = token.slice(0, -1);
    if (vocabulary.has(singular)) return singular;
  }
  return token;
};

const toCanonical = (token: string): string | null => {
  const resolved = resolveAlias(token);
  return vocabulary.has(resolved) ? resolved : null;
};

const normalizeShape = (raw: string): string =>
  raw
    .toLowerCase()
    .normalize("NFKC")
    .trim()
    // 空白区切りで保存された行（`red ribbon` 等）を下線表記へ揃える。
    .replace(/\s+/g, "_")
    .replace(/[^\d'_a-z-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * 1 件の衣装タグを、画像モデルが描ける表記へ正規化する。
 *
 * 語彙に在る語のうち最も後ろのものを主辞に採り、語彙に無い語を落とす
 * （`dark_university_style_blazer` → `dark_blazer`、`casual_top` → `casual`）。
 * 語彙に在る語が1つも無ければ丸ごと落とす。未知の語を別の衣装へ読み替えることは
 * せん。読み替えたら登録した服と違う服が描かれる。
 */
export const normalizeOutfitTag = (raw: string): OutfitTagNormalization => {
  const shaped = normalizeShape(raw);
  if (shaped === "") return { ok: false, reason: "empty" };

  const whole = toCanonical(shaped);
  if (whole !== null) return { ok: true, tag: whole };

  const parts = shaped.split("_");
  for (let end = parts.length; end >= 1; end -= 1) {
    for (let size = Math.min(3, end); size >= 1; size -= 1) {
      const head = toCanonical(parts.slice(end - size, end).join("_"));
      if (head === null) continue;
      const kept = parts.slice(0, end - size).filter((part) => modifiers.has(part));
      return { ok: true, tag: [...kept, head].join("_") };
    }
  }
  return { ok: false, reason: "unknown_head" };
};

export type OutfitTagSanitizeResult = {
  accepted: string[];
  rejected: OutfitTagRejection[];
};

/** 保存経路で使う。採用できた語だけを返し、落とした語は理由付きで残す。 */
export const sanitizeOutfitTags = (raw: readonly string[]): OutfitTagSanitizeResult => {
  const accepted: string[] = [];
  const rejected: OutfitTagRejection[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const result = normalizeOutfitTag(value);
    if (!result.ok) {
      rejected.push({ raw: value, reason: result.reason });
      continue;
    }
    if (seen.has(result.tag)) continue;
    seen.add(result.tag);
    if (accepted.length < MAX_OUTFIT_TAGS) accepted.push(result.tag);
  }
  return { accepted, rejected };
};

/**
 * LLM に選ばせる語の一覧。JSON Schema の enum に入れて、文章の指示やなく
 * 構造で縛る。修飾語付きの造語を作られへんように、複合語も語彙側で持つ。
 */
export const OUTFIT_TAG_ENUM: readonly string[] = Object.keys(OUTFIT_TAG_POST_COUNT).sort();
