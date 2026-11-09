// v2 フェーズ連携プロンプト組み立て（RIT-186）。
// v1 `functions/api/[[route]].ts` + lib の確立ロジックを v2 の台帳フェーズから動かす。
// 値・表は v1 実測の正典（局長採点済み）をそのまま継承し、重みや語を勝手に変えない。

export type ImagePhase =
  | "conversation"
  | "intimate"
  | "erotic"
  | "climax"
  | "afterglow";

export type PhaseGuardrails = {
  readonly negativeExtra: string;
  readonly positiveHint: string;
  readonly allowClimaxTags: boolean;
};

// positiveHint は positive prompt へそのまま連結される。拡散モデルに否定演算子は無いため
// "no nudity" と書くと nudity が positive 側へ入り同じ属性を両側から押す形になる
// （v1 image-phase-guardrails の教訓どおり）。抑制は negativeExtra だけに担わせる。
export const PHASE_GUARDRAILS: Record<ImagePhase, PhaseGuardrails> = {
  conversation: {
    negativeExtra:
      "nsfw, nudity, naked, nude, topless, bottomless, bare, decolletage, cleavage, partially undressed, undressed, undressing, lingerie, underwear, panties, bra, swimsuit, bikini, see-through, exposed, nipples, areola, pussy, anus, clitoris, penis, vaginal, sex, sexual, penetration, intercourse, blowjob, handjob, masturbation, fingering, ahegao, cum, cumshot, creampie, ejaculation, semen, bukkake, orgasm",
    positiveHint:
      "(fully clothed:1.3), (wearing casual clothes:1.2), (covered body:1.2), modest casual outfit",
    allowClimaxTags: false,
  },
  intimate: {
    negativeExtra:
      "sex, penetration, spread_legs, explicit, cum, cumshot, creampie, ejaculation, semen, bukkake, orgasm, ahegao, (fully_clothed:1.4), (dressed:1.3), (clothes:1.3), (shirt:1.3), (panties:1.3), (bra:1.3), (underwear:1.4), (lingerie:1.3)",
    positiveHint:
      "(partially_undressed:1.2), (undressing:1.2), (lingerie:1.2), foreplay",
    allowClimaxTags: false,
  },
  erotic: {
    negativeExtra:
      "cum, cumshot, creampie, ejaculation, semen, bukkake, orgasm, ahegao, fucked_silly, rolling_eyes, (fully_clothed:1.4), (dressed:1.4), (clothes:1.4), (shirt:1.4), (panties:1.4), (bra:1.4), (underwear:1.5), (lingerie:1.4)",
    positiveHint:
      "(completely_nude:1.4), (nude:1.3), (exposed_breasts:1.2), active sexual act in progress",
    allowClimaxTags: false,
  },
  climax: {
    negativeExtra:
      "(extra_hands:1.5),(three_hands:1.5),(mutated_hands:1.4),bad_hands,(extra_arms:1.4),(deformed fingers:1.3),cum_on_face,facial,cum_in_hair,cum_on_hair,bukkake,cum_string_on_face,cum_drip,liquid_drip,(fully_clothed:1.4),(dressed:1.4),(clothes:1.4),(shirt:1.4),(panties:1.4),(bra:1.4),(underwear:1.5),(lingerie:1.4)",
    positiveHint:
      "(completely_nude:1.4), (nude:1.3), (exposed_breasts:1.2), peak climax moment, ejaculation visible",
    allowClimaxTags: true,
  },
  afterglow: {
    negativeExtra:
      "penetration, orgasm, active_intercourse, thrusting, cum_on_face, facial, cum_in_hair, cum_on_hair, bukkake, (fully_clothed:1.4), (dressed:1.4), (clothes:1.4), (shirt:1.4), (panties:1.4), (bra:1.4), (underwear:1.5), (lingerie:1.4)",
    positiveHint:
      "(completely_nude:1.3), (nude:1.2), post-coital aftermath, calm, cum_drip",
    allowClimaxTags: true,
  },
};

// --- タグの正規化と重複排除（v1 image-prompt-anchors 移植） ---
// 概念キーは括弧・重み・大小文字・_ / 空白ゆれを畳む。畳まんと "extra_fingers" と
// "extra fingers" が別タグとして CLIP へ入り実質重み増しになる（v1「盛るな」違反の記録）。
const tagKey = (tag: string): string =>
  tag
    .replace(/^\(+/, "")
    .replace(/:\s*[\d.]+\s*\)*$/, "")
    .replace(/\)+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ");

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
// close-up で顔に集中して「顔・髪まみれホラー」になる本番再現済みの壊れ（v1 2026-06-24）。
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
  "cum_drip",
]);

const FLOATING_CUM_TAG_KEYS = new Set([...FLOATING_CUM_TAGS].map(tagKey));

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

// --- 身元アンカー ---
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

// 肌色タグを高重みアンカーから外す。強調すると白飛び(幽霊化)の原因になるため素タグ末尾。
const SKIN_TONE_ANCHOR_TAGS = [
  "pale skin",
  "fair skin",
  "olive skin",
  "tanned skin",
  "dark skin",
] as const;

export const NOVITA_HAIR_COLOR_NEGATIVE_TAGS =
  "pink_hair, magenta_hair, dyed_hair, rainbow_hair";
export const VISUAL_ANCHOR_WEIGHT = 1.6;
// 会話フェーズだけは正典より弱く当てる（v1 据え置き実測値）。
export const CONVERSATION_VISUAL_ANCHOR_WEIGHT = 1.5;

export const resolveVisualAnchorWeight = (phase: ImagePhase): number =>
  phase === "conversation" ? CONVERSATION_VISUAL_ANCHOR_WEIGHT : VISUAL_ANCHOR_WEIGHT;

export const hasUsableIdentityAnchor = (visualAnchors: string): boolean =>
  visualAnchors.split(",").some((tag) => tag.trim().length > 0);

export const buildVisualAnchorPrompt = (
  visualAnchors: string,
  weight: number,
): string => {
  const trimmedAnchors = visualAnchors
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (trimmedAnchors.length === 0) return "";

  const normalized = trimmedAnchors.map((tag) => tag.toLowerCase());
  const skinToneIndices = new Set(
    normalized
      .map((tag, i) =>
        (SKIN_TONE_ANCHOR_TAGS as readonly string[]).includes(tag) ? i : -1,
      )
      .filter((i) => i !== -1),
  );
  const skinToneTags = trimmedAnchors.filter((_, i) => skinToneIndices.has(i));
  const nonSkinTags = trimmedAnchors.filter((_, i) => !skinToneIndices.has(i));

  const normalizedNonSkin = nonSkinTags.map((tag) => tag.toLowerCase());
  const hairColorIndex = normalizedNonSkin.findIndex((tag) =>
    (HAIR_COLOR_ANCHOR_TAGS as readonly string[]).includes(tag),
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

// --- conversation フェーズの露出タグ除去 ---
const normalizeTagWords = (raw: string): string[] => {
  const body = raw
    .replace(/^\(+/, "")
    .replace(/:\s*[\d.]+\s*\)*$/, "")
    .replace(/\)+$/, "")
    .replace(/[\d().:]/g, "")
    .replace(/[_-]/g, " ")
    .toLowerCase()
    .trim();
  return body.split(/\s+/).filter(Boolean);
};

const CONVERSATION_FORBIDDEN_TAG_WORDS: ReadonlySet<string> = new Set([
  "nude", "naked", "topless", "bottomless", "bare", "decolletage", "cleavage",
  "lingerie", "underwear", "panties", "bra", "swimsuit", "bikini", "exposed",
  "nipples", "areola", "pussy", "anus", "clitoris", "penis", "vaginal", "sex",
  "penetration", "intercourse", "blowjob", "handjob", "masturbation",
  "fingering", "ahegao", "undressed", "undressing", "nobra", "nopanties",
  "noclothes", "seethrough", "sheer", "downblouse", "upskirt",
]);

const CONVERSATION_FORBIDDEN_TAG_PHRASES: readonly string[][] = [
  ["bare", "shoulders"], ["bare", "arms"], ["bare", "legs"], ["bare", "chest"],
  ["bare", "breasts"], ["off", "shoulder"], ["off", "shoulders"],
  ["no", "bra"], ["no", "panties"], ["no", "clothes"],
  ["partially", "undressed"], ["partially", "undressing"],
  ["see", "through"], ["see", "thru"], ["wardrobe", "malfunction"],
];

const isConversationForbiddenTag = (raw: string): boolean => {
  const words = normalizeTagWords(raw);
  if (words.length === 0) return true;
  for (const word of words) {
    if (CONVERSATION_FORBIDDEN_TAG_WORDS.has(word)) return true;
  }
  for (let i = 0; i <= words.length - 2; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    for (const phrase of CONVERSATION_FORBIDDEN_TAG_PHRASES) {
      if (bigram === phrase.join(" ")) return true;
    }
  }
  return false;
};

export const sanitizeImageTagsForPhase = (phase: ImagePhase, tags: string): string => {
  if (phase !== "conversation") return tags;
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => !isConversationForbiddenTag(tag))
    .join(", ");
};

// --- 日本語シーン文からの明示コンテンツ検知（v1 image-explicit-tags 移植） ---
// 台帳フェーズが pre-climax に留まっていても、本文が射精系を含むなら
// 対応タグを足してシーンへの忠実度を守る。
const normalize = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/g, "");

const EXPLICIT_TAG_RULES: readonly { tags: readonly string[]; keywords: readonly string[] }[] = [
  {
    tags: ["creampie", "cum_in_pussy", "cum_inside", "ejaculation"],
    keywords: ["中出し", "中だし", "中に出", "中にだ", "中で出", "中でいく", "中でいき", "中でイ", "なかだし"],
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

export const detectExplicitContent = (
  text: string,
): { detected: boolean; tags: string[] } => {
  const scan = normalize(text);
  const tagSet = new Set<string>();
  for (const rule of EXPLICIT_TAG_RULES) {
    if (rule.keywords.some((kw) => scan.includes(normalize(kw)))) {
      for (const tag of rule.tags) tagSet.add(tag);
    }
  }
  return { detected: tagSet.size > 0, tags: [...tagSet] };
};

// --- フェーズ別の被写体・表情 ---
// conversation は女性キャラ単独。intimate 以降は相手との場面として描く（v1 仕様）。
export const subjectTagsForPhase = (phase: ImagePhase): string =>
  phase === "conversation" ? "1girl, solo" : "1girl, 1boy, hetero, couple";

const PHASE_EXPRESSION_TAGS: Record<ImagePhase, readonly string[]> = {
  conversation: [""],
  intimate: [""],
  erotic: [
    "(open_mouth:1.2), blush, sweat, pussy_juice, saliva_trail",
    "half_closed_eyes, flushed_face, parted_lips, heavy_breathing",
    "lovestruck, needy_expression, wet_lips, blushing",
    "lustful_eyes, moaning, drool, body_flush",
  ],
  climax: [
    "(ahegao:1.2), tongue_out, half_closed_eyes, full_body_blush, (creampie:1.3), cum_in_pussy, cum_overflow, cum_dripping_from_pussy",
  ],
  afterglow: [
    "peaceful, closed_eyes, gentle_smile, afterglow, exhausted, cum_drip, cum_on_thighs, messy, wet",
  ],
};

const PHASE_FORBIDDEN_EXPRESSIONS: Record<ImagePhase, string> = {
  conversation: "",
  intimate: "angry, annoyed, disinterest, bored",
  erotic:
    "angry, annoyed, disinterest, bored, calm, neutral_expression, frown, fully_clothed",
  climax:
    "angry, annoyed, calm, neutral_expression, fully_clothed, standing, bored, frown",
  afterglow: "angry, annoyed, penetration",
};

export const forbiddenExpressionForPhase = (phase: ImagePhase): string =>
  PHASE_FORBIDDEN_EXPRESSIONS[phase];

// 表情候補はターン番号で回す。v1 は重複回避キャッシュだったが、v2 は state を持たず
// 決定的にずらすだけで同じ表情の連発を避けられる。
export const phaseExpressionForPhase = (phase: ImagePhase, turn: number): string => {
  const options = PHASE_EXPRESSION_TAGS[phase];
  if (options.length === 0) return "";
  return options[((turn % options.length) + options.length) % options.length] ?? "";
};

// --- 既知の失敗タグ（image-prompt-ssot の表）---
// 目視確定済みの壊れを起こすタグは常に negative 側へ。ユーザー指定で上書きされても落とさん。
export const KNOWN_FAILURE_NEGATIVE =
  "impregnation, uncensored, detailed pussy, mosaic_censoring, bar_censor, camera, tripod";

// --- LoRA ピン留めレシピ（v1 route-context の10点実証レシピ） ---
// negative は実証済み短文で全置換する。長 negative は LoRA の身元固定と喧嘩して盛り過ぎになる。
export const LORA_PINNED_RECIPE = {
  width: 832,
  height: 1216,
  steps: 30,
  guidanceScale: 5,
  negativePrompt:
    "lowres, bad anatomy, worst quality, extra limbs, extra fingers, deformed, huge breasts, gigantic breasts, mutated hands, text, watermark",
} as const;
