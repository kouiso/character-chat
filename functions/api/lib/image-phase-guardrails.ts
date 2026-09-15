import type { ScenePhase } from "../../../src/lib/scene-phase";

// フェーズ別のガードレールを 1 箇所に集約する。
// route ハンドラ内に散らばっていた phaseNegativeExtra と
// 翻訳 LLM の "MANDATORY cum for erotic" 指示がフェーズ整合を崩していたため、
// negative / positive / climax 後処理判定を同居させ仕様ドリフトを防ぐ。
export type PhaseGuardrails = {
  readonly negativeExtra: string;
  readonly positiveHint: string;
  readonly allowClimaxTags: boolean;
};

// positiveHint は positive prompt へそのまま連結される。拡散モデルに否定演算子は無いため
// "no nudity" と書くと nudity が positive 側へ入り、同じ属性を positive と negative の
// 両方から押す形になる(char-approval-process.md「欠陥の反対方向へ両側から押すな」)。
// 抑制は negativeExtra だけに担わせ、positiveHint は肯定形のみで書く。
const NEGATION_IN_POSITIVE_PATTERN = /\b(?:no|not|without)\b/i;

export const containsNegationPhrase = (hint: string): boolean =>
  NEGATION_IN_POSITIVE_PATTERN.test(hint);

export const PHASE_GUARDRAILS: Record<ScenePhase, PhaseGuardrails> = {
  conversation: {
    // 会話フェーズは性的要素全般を拒否する。最も厳格な default として使う。
    // LoRA 経路でも conversation は衣服・屋外を維持するため、衣服欠損タグを入念に negative 側へ置く。
    negativeExtra:
      "nsfw, nudity, naked, nude, topless, bottomless, bare, decolletage, cleavage, partially undressed, undressed, undressing, lingerie, underwear, panties, bra, swimsuit, bikini, see-through, exposed, nipples, areola, pussy, anus, clitoris, penis, vaginal, sex, sexual, penetration, intercourse, blowjob, handjob, masturbation, fingering, ahegao, cum, cumshot, creampie, ejaculation, semen, bukkake, orgasm",
    positiveHint:
      "(fully clothed:1.3), (wearing casual clothes:1.2), (covered body:1.2), modest casual outfit",
    allowClimaxTags: false,
  },
  intimate: {
    // 前戯・脱衣フェーズ。挿入と射精系は拒否、抱擁・キスは許可。
    // 衣服を完全に残さないよう、服装タグを強めに抑制する。
    negativeExtra:
      "sex, penetration, spread_legs, explicit, cum, cumshot, creampie, ejaculation, semen, bukkake, orgasm, ahegao, (fully_clothed:1.4), (dressed:1.3), (clothes:1.3), (shirt:1.3), (panties:1.3), (bra:1.3), (underwear:1.4), (lingerie:1.3)",
    positiveHint: "(partially_undressed:1.2), (undressing:1.2), (lingerie:1.2), foreplay",
    allowClimaxTags: false,
  },
  erotic: {
    // 性行為進行中。性行為タグは許可 (sex, penetration) するが、
    // 射精・絶頂・アヘ顔のみ climax 専用としてブロックする (mid-act state)。
    // 裸体を肯定し、服・下着が残るのを強く抑制する。
    negativeExtra:
      "cum, cumshot, creampie, ejaculation, semen, bukkake, orgasm, ahegao, fucked_silly, rolling_eyes, (fully_clothed:1.4), (dressed:1.4), (clothes:1.4), (shirt:1.4), (panties:1.4), (bra:1.4), (underwear:1.5), (lingerie:1.4)",
    positiveHint:
      "(completely_nude:1.4), (nude:1.3), (exposed_breasts:1.2), active sexual act in progress",
    allowClimaxTags: false,
  },
  climax: {
    // 中出し(creampie)は残すが、顔・髪へのザーメン飛沫(bukkake)はブロック。
    // close-up 構図だと汎用 cum タグが顔に集中し「顔・髪まみれホラー」になる原因だった(2026-06-24)。
    // 裸体を肯定し、服・下着が残るのを強く抑制する。
    negativeExtra:
      "(extra_hands:1.5),(three_hands:1.5),(mutated_hands:1.4),bad_hands,(extra_arms:1.4),(deformed fingers:1.3),cum_on_face,facial,cum_in_hair,cum_on_hair,bukkake,cum_string_on_face,cum_drip,liquid_drip,(fully_clothed:1.4),(dressed:1.4),(clothes:1.4),(shirt:1.4),(panties:1.4),(bra:1.4),(underwear:1.5),(lingerie:1.4)",
    positiveHint:
      "(completely_nude:1.4), (nude:1.3), (exposed_breasts:1.2), peak climax moment, ejaculation visible",
    allowClimaxTags: true,
  },
  afterglow: {
    // 事後余韻。射精中・性行為中の表現は弾くが、cum_drip 等の事後流体は許可リストで残す。
    // 顔・髪へのザーメン飛沫は事後でもホラー化するためブロック。
    // 余韻でも裸体は維持し、衣服が巻き戻るのを抑制する。
    negativeExtra:
      "penetration, orgasm, active_intercourse, thrusting, cum_on_face, facial, cum_in_hair, cum_on_hair, bukkake, (fully_clothed:1.4), (dressed:1.4), (clothes:1.4), (shirt:1.4), (panties:1.4), (bra:1.4), (underwear:1.5), (lingerie:1.4)",
    positiveHint: "(completely_nude:1.3), (nude:1.2), post-coital aftermath, calm, cum_drip",
    allowClimaxTags: true,
  },
};

// 翻訳 LLM がフェーズ無視で吐く可能性のある climax 系トークン。
// allowClimaxTags=false のフェーズで部分一致ではなくトークン単位で除去する。
const CLIMAX_TAG_TOKENS: readonly string[] = [
  "cum",
  "cumshot",
  "creampie",
  "ejaculation",
  "ejaculating",
  "semen",
  "bukkake",
  "orgasm",
  "cum_in_pussy",
  "cum_inside",
  "cum_on_face",
  "cum_on_body",
  "cum_in_mouth",
];

// allowClimaxTags=true の afterglow フェーズでも残してはいけない「現在進行中の射精」を表すタグ。
// cum_drip 等の事後流体表現とは意味が異なるため、afterglow 後処理で常に除去する。
const ACTIVE_CLIMAX_TAG_TOKENS: ReadonlySet<string> = new Set([
  "cum_in_pussy",
  "cum_inside",
  "cum_in_mouth",
  "cumshot",
  "ejaculation",
  "ejaculating",
  "bukkake",
  "orgasm",
]);

// 事後フェーズで残したい流体表現。allowClimaxTags=true の afterglow で使う想定だが、
// stripClimaxTags が他フェーズで誤って呼ばれても事故を防ぐため許可リストで明示する。
const POST_COITAL_ALLOW: ReadonlySet<string> = new Set([
  "cum_drip",
  "cum_on_thighs",
  "cum_pool",
  "messy",
  "wet",
]);

// 重み付きタグ (cum:1.3) や括弧・数値・コロンを取り除いて素のトークン名にする。
// 完全一致比較に持ち込むことで cum_drip 等の prefix 一致誤削除を避ける。
const normalizeTagToken = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[\d().:]/g, "")
    .trim();

// sanitizeImageTagsForPhase で使う正規化。ハイフン/アンダースコアを空白に寄せ、
// 重み括弧を外してから単語列に分割する。image-prompt-anchors.ts の tagKey と
// 同じ「概念を 1 つの空白区切りに畳む」方針で、表記ゆれを吸収する。
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

// conversation フェーズで翻訳 LLM が衣服を無視して裸/過度な露出タグを吐くのを防ぐ。
// タグを 1 つずつ見て、単語か連続単語が禁止セットに含まれるものを除去する。
const CONVERSATION_FORBIDDEN_TAG_WORDS: ReadonlySet<string> = new Set([
  "nude",
  "naked",
  "topless",
  "bottomless",
  "bare",
  "decolletage",
  "cleavage",
  "lingerie",
  "underwear",
  "panties",
  "bra",
  "swimsuit",
  "bikini",
  "exposed",
  "nipples",
  "areola",
  "pussy",
  "anus",
  "clitoris",
  "penis",
  "vaginal",
  "sex",
  "penetration",
  "intercourse",
  "blowjob",
  "handjob",
  "masturbation",
  "fingering",
  "ahegao",
  "undressed",
  "undressing",
  "nobra",
  "nopanties",
  "noclothes",
  "seethrough",
  "sheer",
  "downblouse",
  "upskirt",
]);

const CONVERSATION_FORBIDDEN_TAG_PHRASES: readonly string[][] = [
  ["bare", "shoulders"],
  ["bare", "arms"],
  ["bare", "legs"],
  ["bare", "chest"],
  ["bare", "breasts"],
  ["off", "shoulder"],
  ["off", "shoulders"],
  ["no", "bra"],
  ["no", "panties"],
  ["no", "clothes"],
  ["partially", "undressed"],
  ["partially", "undressing"],
  ["see", "through"],
  ["see", "thru"],
  ["wardrobe", "malfunction"],
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

export const sanitizeImageTagsForPhase = (phase: ScenePhase, tags: string): string => {
  if (phase !== "conversation") return tags;
  const parts = tags.split(",").map((t) => t.trim());
  const filtered = parts.filter((t) => !isConversationForbiddenTag(t));
  return filtered.join(", ");
};

// 翻訳 LLM が場所未指定時に bedroom/bed 等を勝手に足すのを防ぐ。
// 解決済みの背景タグ(keepTags)がある場合、それと競合する汎用背景タグを imagePromptRaw から除去する。
const GENERIC_LOCATION_PHRASES: ReadonlySet<string> = new Set([
  "indoor",
  "indoors",
  "bedroom",
  "bed",
  "on bed",
  "in bed",
  "living room",
  "on sofa",
  "sofa",
  "couch",
  "bathroom",
  "kitchen",
  "office",
  "classroom",
  "love hotel",
  "hotel",
  "outdoors",
  "outdoor",
  "alley",
  "apartment room",
  "apartment",
  "bar",
  "car interior",
  "park",
  "street",
  "room",
]);

export const stripConflictingLocationTags = (tags: string, keepTags: string): string => {
  if (!tags.trim() || !keepTags.trim()) return tags;
  const keepPhrases = keepTags
    .split(",")
    .map((t) => normalizeTagWords(t.trim()).join(" "))
    .filter(Boolean);
  const keepSet = new Set(keepPhrases);
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => {
      const phrase = normalizeTagWords(t).join(" ");
      if (!phrase) return false;
      if (keepSet.has(phrase)) return true;
      return !GENERIC_LOCATION_PHRASES.has(phrase);
    })
    .join(", ");
};

export const stripClimaxTags = (tags: string): string => {
  const parts = tags.split(",").map((t) => t.trim());
  const filtered = parts.filter((t) => {
    const normalized = normalizeTagToken(t);
    if (normalized === "") return false;
    if (POST_COITAL_ALLOW.has(normalized)) return true;
    return !CLIMAX_TAG_TOKENS.some((bad) => normalized === bad);
  });
  return filtered.join(", ");
};

// afterglow 用。allowClimaxTags=true でも cum_in_pussy / cum_inside など
// 「現在進行中」タグだけは弾き、cum_drip 等の事後流体は残す。
export const stripActiveClimaxTags = (tags: string): string => {
  const parts = tags.split(",").map((t) => t.trim());
  const filtered = parts.filter((t) => {
    const normalized = normalizeTagToken(t);
    if (normalized === "") return false;
    if (POST_COITAL_ALLOW.has(normalized)) return true;
    return !ACTIVE_CLIMAX_TAG_TOKENS.has(normalized);
  });
  return filtered.join(", ");
};

// 入力プロンプト (Japanese scene text) に明示的な射精キーワードが含まれていると、
// 翻訳 LLM がフェーズを無視して climax タグを吐く。事前除去で input 側を中立化する。
const JP_CLIMAX_PATTERNS: readonly RegExp[] = [
  /射精/g,
  /中出し/g,
  /中に出す/g,
  /中にだす/g,
  /中に出して/g,
  /中にだして/g,
  /精液/g,
  /ぶっかけ/g,
  /ザーメン/g,
  /どくどく出/g,
  /どくどくだ/g,
];

export const stripJpClimaxKeywords = (prompt: string): string => {
  let result = prompt;
  for (const re of JP_CLIMAX_PATTERNS) {
    result = result.replace(re, "");
  }
  return result;
};
