const HAIR_COLOR_ANCHOR_TAGS = [
  "brown hair",
  "black hair",
  "blonde hair",
  "silver hair",
  "white hair",
  "blue hair",
  "green hair",
  "purple hair",
  "red hair",
] as const;

// 肌色タグを高重みアンカーから除外する。
// pale skin:1.9 のような強調は肌を白飛び(幽霊化)させる原因になるため、
// 素タグ(重みなし)として末尾に追加する。
const SKIN_TONE_ANCHOR_TAGS = [
  "pale skin",
  "fair skin",
  "olive skin",
  "tanned skin",
  "dark skin",
] as const;

export const NOVITA_HAIR_COLOR_NEGATIVE_TAGS = "pink_hair, magenta_hair, dyed_hair, rainbow_hair";
export const VISUAL_ANCHOR_WEIGHT = 1.6;
// 会話フェーズだけは正典より弱く当てる。据え置きの実測値。
export const CONVERSATION_VISUAL_ANCHOR_WEIGHT = 1.5;

// image_meta 由来の不変ブロックは verbatim 継承が正で、重みを盛るほど硬いテカリ・
// 高彩度へ振れる(char-approval-process.md「質感ゲート」)。intimate 以降だけ 1.9 へ
// 上げていた分を正典の VISUAL_ANCHOR_WEIGHT まで戻す。どのフェーズでも正典を超えない。
export const resolveVisualAnchorWeight = (phase: string): number =>
  phase === "conversation" ? CONVERSATION_VISUAL_ANCHOR_WEIGHT : VISUAL_ANCHOR_WEIGHT;

// 同一タグの重複(大文字小文字・重み括弧を無視)を最初の1つに畳む。
// climax は phaseExpression と翻訳済みプロンプトが同じ climax タグ(ahegao/cum/creampie 等)を
// 二重三重に積み、モデルが「全身ぶっかけ・顔崩壊」と誤解する原因になっていた(2026-06-24 本番再現)。
// 重複排除で構図を安定させる(強度は変えない)。negative 側の手タグ三重複も畳めて 1024 runes 超過も緩和。
// タグから重み括弧を外した概念キー(比較用)。"(cum:1.3)" -> "cum"。
// アンダースコアと空白は同じ概念の表記ゆれなので 1 つに寄せる。寄せないと
// "extra_fingers" と "extra fingers" が別タグとして両方 CLIP に入り、同一概念を
// 2〜3 回繰り返す = 実質的な重み増しになる(char-approval-process.md「盛るな」違反)。
const tagKey = (tag: string): string =>
  tag
    .replace(/^\(+/, "")
    .replace(/:\s*[\d.]+\s*\)*$/, "")
    .replace(/\)+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ");

// カンマで素朴に割ると `(blue eyes, anime, best_quality:1.6)` のような重み付きグループが
// 途中で千切れ、閉じ括弧と重みを失った断片が残る。括弧の外側のカンマだけで区切る。
const splitTopLevelTags = (prompt: string): string[] => {
  const tags: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of prompt) {
    if (char === "," && depth === 0) {
      tags.push(current);
      current = "";
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    current += char;
  }
  tags.push(current);
  return tags;
};

const parseWeightedGroup = (tag: string): { body: string; weight: string } | null => {
  const matched = /^\((.*):\s*([\d.]+)\)$/s.exec(tag);
  return matched ? { body: matched[1], weight: matched[2] } : null;
};

export const dedupePromptTags = (prompt: string): string => {
  const seen = new Set<string>();
  const dedupeTag = (raw: string): string => {
    const tag = raw.trim();
    if (!tag) return "";

    const group = parseWeightedGroup(tag);
    if (group) {
      const members = splitTopLevelTags(group.body).map(dedupeTag).filter(Boolean);
      return members.length === 0 ? "" : `(${members.join(", ")}:${group.weight})`;
    }

    const key = tagKey(tag);
    if (key && seen.has(key)) return "";
    if (key) seen.add(key);
    return tag;
  };

  return splitTopLevelTags(prompt).map(dedupeTag).filter(Boolean).join(", ");
};

// 顔・髪・宙に飛ぶ汎用ザーメンタグ。中出し(creampie/cum_in_pussy 等の局所タグ)は含めない。
// 翻訳 LLM が「中出し/絶頂」から cum/ejaculation/cum_inside を吐き、close-up で顔に集中して
// 「顔・髪まみれホラー」になる(2026-06-24 本番再現+目視N=2)。これらだけ除去し中出しは残す。
const FLOATING_CUM_TAGS = new Set([
  "cum",
  "semen",
  "facial",
  "cum_on_face",
  "cum_on_hair",
  "cum_in_hair",
  "bukkake",
  "cumshot",
  "cum_string",
  "cum_string_on_face",
  "ejaculation",
  "cum_inside",
  "excessive_cum",
  // 顔・頬・顎に垂れる汎用タグ。内部結合タグ(cum_dripping_from_pussy等)は除外しない
  "cum_drip",
]);

// tagKey は表記ゆれを空白へ寄せるため、判定セット側も同じ正規化を通してから引く。
const FLOATING_CUM_TAG_KEYS = new Set([...FLOATING_CUM_TAGS].map((tag) => tagKey(tag)));

// 重み付きグループ `(a, b:1.6)` は 1 タグとして扱い、禁止タグは**グループの中身から**外す。
// カンマで素朴に割ると閉じ括弧と重みを持つ末尾片が落ちて `(a` だけが残る。
const stripForbiddenInsideGroup = (group: string): string => {
  const weightedGroup = parseWeightedGroup(group);
  if (!weightedGroup) return group;
  const kept = splitTopLevelTags(weightedGroup.body)
    .map((tag) => tag.trim())
    .map((tag) => (tag.startsWith("(") ? stripForbiddenInsideGroup(tag) : tag))
    .filter((tag) => tag && !FLOATING_CUM_TAG_KEYS.has(tagKey(tag)));
  return kept.length === 0 ? "" : `(${kept.join(", ")}:${weightedGroup.weight})`;
};

export const stripFloatingCumTags = (prompt: string): string =>
  splitTopLevelTags(prompt)
    .map((tag) => tag.trim())
    .map((tag) => (tag.startsWith("(") ? stripForbiddenInsideGroup(tag) : tag))
    .filter((tag) => tag && !FLOATING_CUM_TAG_KEYS.has(tagKey(tag)))
    .join(", ");

// 身元タグが 1 つも無い状態での生成は禁止(char-approval-process.md
// 「image_meta NULL のまま画像生成 = 違反」/ sakura ホラー化の有力原因)。
// image_meta → character_visual → visual_prompt の全経路が空だった時だけ真になる。
export const hasUsableIdentityAnchor = (visualAnchors: string): boolean =>
  visualAnchors.split(",").some((tag) => tag.trim().length > 0);

export const buildVisualAnchorPrompt = (visualAnchors: string, weight: number): string => {
  const trimmedAnchors = visualAnchors
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (trimmedAnchors.length === 0) return "";

  const normalized = trimmedAnchors.map((tag) => tag.toLowerCase());

  // 肌色タグは重み強調対象外(白飛び防止)。素タグとして末尾に追加する。
  const skinToneIndices = new Set(
    normalized
      .map((tag, i) => (SKIN_TONE_ANCHOR_TAGS.includes(tag as never) ? i : -1))
      .filter((i) => i !== -1),
  );
  const skinToneTags = trimmedAnchors.filter((_, i) => skinToneIndices.has(i));
  const nonSkinTags = trimmedAnchors.filter((_, i) => !skinToneIndices.has(i));

  const normalizedNonSkin = nonSkinTags.map((tag) => tag.toLowerCase());
  const hairColorIndex = normalizedNonSkin.findIndex((tag) =>
    HAIR_COLOR_ANCHOR_TAGS.includes(tag as never),
  );

  let weightedPart: string;
  if (nonSkinTags.length === 0) {
    weightedPart = "";
  } else if (hairColorIndex === -1) {
    weightedPart = `(${nonSkinTags.join(", ")}:${weight})`;
  } else {
    const hairColorTag = nonSkinTags[hairColorIndex];
    const remainingTags = nonSkinTags.filter((_, index) => index !== hairColorIndex);
    weightedPart = [
      `(${hairColorTag}:${weight})`,
      remainingTags.length > 0 ? `(${remainingTags.join(", ")}:${weight})` : "",
    ]
      .filter(Boolean)
      .join(", ");
  }

  return [weightedPart, ...skinToneTags].filter(Boolean).join(", ");
};
