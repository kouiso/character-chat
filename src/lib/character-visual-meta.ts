import {
  type BODY_TYPE,
  type HAIR_COLOR,
  type HAIR_LENGTH,
  type VisualMeta,
} from "@/schema/character-visual-enums";
import { sanitizeOutfitTags } from "@/schema/outfit-tag";

export type HairColor = (typeof HAIR_COLOR)[number];
export type HairLength = (typeof HAIR_LENGTH)[number];
export type BodyType = (typeof BODY_TYPE)[number];

export interface VisualDraftState {
  hairColor: HairColor;
  hairLength: HairLength;
  bodyType: BodyType;
  defaultOutfit: string;
}

export const DEFAULT_VISUAL_DRAFT: VisualDraftState = {
  hairColor: "black",
  hairLength: "medium",
  bodyType: "average",
  defaultOutfit: "",
};

// フォームの初期表示に使う既定値。ユーザーが選んだ値ではないので、そのまま保存してはいけない。
export const DEFAULT_VISUAL_META: VisualMeta = {
  hairColor: "black",
  hairStyle: "straight",
  hairLength: "medium",
  eyeColor: "brown",
  skinTone: "fair",
  bodyType: "average",
  breastSize: null,
  heightBand: null,
  ageApparent: 18,
  distinctiveMarks: [],
  defaultOutfit: [],
  undressProgression: {},
};

export const createVisualDraftState = (meta?: VisualMeta | null): VisualDraftState => {
  if (!meta) return DEFAULT_VISUAL_DRAFT;
  return {
    hairColor: meta.hairColor,
    hairLength: meta.hairLength,
    bodyType: meta.bodyType,
    defaultOutfit: meta.defaultOutfit.join(", "),
  };
};

export const parseVisualWords = (value: string): string[] =>
  value
    .split(/[,、]/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 30);

/**
 * #923: 入力欄の文字列を、画像モデルが描ける衣装タグへ揃える。
 * 画面側で弾いた語を知らせるため、落とした語も返す。
 */
export const parseOutfitInput = (value: string): { accepted: string[]; rejected: string[] } => {
  const { accepted, rejected } = sanitizeOutfitTags(parseVisualWords(value));
  return { accepted, rejected: rejected.map((r) => r.raw) };
};

export const visualDraftToMeta = (
  draft: VisualDraftState,
  baseMeta?: VisualMeta | null,
): VisualMeta => ({
  ...(baseMeta ?? DEFAULT_VISUAL_META),
  hairColor: draft.hairColor,
  hairLength: draft.hairLength,
  bodyType: draft.bodyType,
  defaultOutfit: parseOutfitInput(draft.defaultOutfit).accepted,
});

export type ResolveVisualMetaInput = {
  draft: VisualDraftState;
  // 既存の character_visual 行。無いキャラは null
  baseMeta?: VisualMeta | null;
  // 見た目の入力欄をユーザーが実際に触ったか
  visualTouched: boolean;
};

/**
 * #597: 保存時に「誰も選んでいない既定値」の行を作らせない。
 *
 * 行が無いキャラを編集するとフォームは既定値(黒髪・茶目・average)を表示する。
 * 従来はその表示値をそのまま PATCH していたため、ただ名前を直しただけで
 * 銀髪キャラに黒髪が焼き付いた。行の有無と「実際に触ったか」を区別して、
 * 根拠の無い外見を書かない。
 *
 * @returns 保存すべき VisualMeta。保存してはいけない場合は null
 */
export const resolveVisualMetaForSave = ({
  draft,
  baseMeta,
  visualTouched,
}: ResolveVisualMetaInput): VisualMeta | null => {
  if (baseMeta) return visualDraftToMeta(draft, baseMeta);
  if (!visualTouched) return null;
  return visualDraftToMeta(draft, null);
};

// 日本語・英語どちらの記述からも髪色を拾う。ユーザーが書いた記述だけを根拠にする。
const HAIR_COLOR_PATTERNS: Array<[RegExp, HairColor]> = [
  [/銀髪|シルバーヘア|silver hair/i, "silver"],
  [/金髪|ブロンド|blonde hair|blond hair/i, "blonde"],
  [/白髪|white hair/i, "white"],
  [/茶髪|栗色|ブラウンヘア|brown hair/i, "brown"],
  [/黒髪|black hair/i, "black"],
  [/赤髪|red hair/i, "red"],
  [/桃色の髪|ピンク髪|pink hair/i, "pink"],
  [/青髪|blue hair/i, "blue"],
  [/緑髪|green hair/i, "green"],
  [/紫髪|purple hair/i, "purple"],
];

const HAIR_LENGTH_PATTERNS: Array<[RegExp, HairLength]> = [
  [/ロングヘア|長い髪|long hair/i, "long"],
  [/ショートヘア|短い髪|short hair/i, "short"],
  [/ミディアム|medium hair/i, "medium"],
];

const BODY_TYPE_PATTERNS: Array<[RegExp, BodyType]> = [
  [/華奢|細身|slender|slim/i, "slender"],
  [/小柄|petite/i, "petite"],
  [/豊満|グラマー|voluptuous/i, "voluptuous"],
  [/むっちり|curvy/i, "curvy"],
  [/引き締ま|athletic/i, "athletic"],
];

const firstMatch = <T>(text: string, patterns: Array<[RegExp, T]>): T | null => {
  for (const [pattern, value] of patterns) {
    if (pattern.test(text)) return value;
  }
  return null;
};

/**
 * キャラ生成結果のテキストから外見を推定する。
 *
 * 髪色の根拠が1つも無ければ null を返す。髪色は weight 1.6 の anchor になる
 * 最重要項目なので、当て推量で行を作るくらいなら行を作らん方がええ。
 */
export const deriveVisualMetaFromText = (text: string): VisualMeta | null => {
  const hairColor = firstMatch(text, HAIR_COLOR_PATTERNS);
  if (!hairColor) return null;

  return {
    ...DEFAULT_VISUAL_META,
    hairColor,
    hairLength: firstMatch(text, HAIR_LENGTH_PATTERNS) ?? DEFAULT_VISUAL_META.hairLength,
    bodyType: firstMatch(text, BODY_TYPE_PATTERNS) ?? DEFAULT_VISUAL_META.bodyType,
  };
};
