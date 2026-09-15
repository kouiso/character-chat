// シーンの日本語表現から、剥がしてはいけない明示的タグ（中出し/お腹パンパン等）を導出する。
// detectScenePhase が pre-climax と誤判定しても、ここで明示コンテンツを検知できれば
// stripJpClimaxKeywords / stripClimaxTags による cum 系タグ除去を抑止する根拠になる。

const normalize = (text: string): string => text.normalize("NFKC").replace(/\s+/g, "");

type ExplicitTagRule = {
  // この表現が出たら付与する SD タグ群
  readonly tags: readonly string[];
  // 表現バリエーション（normalize 済み前提の素片）
  readonly keywords: readonly string[];
};

const EXPLICIT_TAG_RULES: readonly ExplicitTagRule[] = [
  {
    tags: ["creampie", "cum_in_pussy", "cum_inside", "ejaculation"],
    keywords: [
      "中出し",
      "中だし",
      "中に出",
      "中にだ",
      "中で出",
      "中でいく",
      "中でいき",
      "中でイ",
      "なかだし",
    ],
  },
  {
    tags: ["stomach_bulge", "cum_inflation"],
    keywords: ["お腹パンパン", "おなかパンパン", "腹パンパン", "孕", "はらませ", "ぱんぱん"],
  },
  {
    tags: ["cum", "semen", "ejaculation"],
    keywords: ["射精", "ぶっかけ", "どくどく", "精液"],
  },
];

export type ExplicitContentResult = {
  // 何らかの明示コンテンツが検知されたか（cum 系タグ保護の発火条件）
  detected: boolean;
  // 付与すべきタグ（重複除去済み）
  tags: string[];
};

export const detectExplicitContent = (text: string): ExplicitContentResult => {
  const scan = normalize(text);
  const tagSet = new Set<string>();
  for (const rule of EXPLICIT_TAG_RULES) {
    if (rule.keywords.some((kw) => scan.includes(normalize(kw)))) {
      for (const tag of rule.tags) tagSet.add(tag);
    }
  }
  return { detected: tagSet.size > 0, tags: [...tagSet] };
};
