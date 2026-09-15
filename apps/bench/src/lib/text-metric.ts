import { NON_JAPANESE_HAN_CHARS } from "./char-set.ts";

// 機械7軸。純粋関数だけを置く。ファイル I/O もモデル呼び出しもここには入れん。
// 「抜けたか」は人間の1軸として最後まで残すので、ここには実装せん。

/** prohibitions.md の減点軸1「AI臭い言い回し」の辞書。前身の分析と同じ語で始めとる。 */
export const AI_SMELL_PHRASES = [
  "快感に襲わ",
  "絶頂を迎え",
  "理性が飛",
  "甘い痺れ",
  "電流が走",
  "頭が真っ白",
  "言葉にならな",
  "身体の奥が疼",
  "もう我慢でき",
  "溶けてしま",
  "支配され",
  "本能のまま",
  "背筋が",
] as const;

/** 拒否・メタ発言。エロ品質やのうて「素に戻った」検出用。 */
export const META_REFUSAL_PHRASES = [
  "申し訳",
  "AIとして",
  "お答えでき",
  "私はAI",
  "規約",
  "ポリシー",
  "できません",
] as const;

// 強度語彙。段階が上がるほど重みを増やす。エスカレーションの傾きだけに使うので絶対値に意味は無い。
const INTENSITY_LEXICON: ReadonlyArray<readonly [readonly string[], number]> = [
  [["見つめ", "触れ", "手を", "近づ", "微笑", "囁", "頬", "髪", "肩"], 1],
  [["唇", "キス", "抱きしめ", "撫で", "胸", "肌", "服", "脱", "熱く", "息が"], 2],
  [["乳首", "太もも", "下着", "濡れ", "喘", "腰", "舌", "愛撫", "指を", "秘部"], 3],
  [["挿入", "膣", "腟", "肉棒", "咥え", "突き上げ", "抜き差し", "奥を", "子宮"], 4],
  [["絶頂", "イく", "イっ", "射精", "精液", "痙攣", "潮", "中出し", "果て"], 5],
];

export type CharClassRatio = {
  hiragana: number;
  katakana: number;
  kanji: number;
  latin: number;
  digit: number;
  other: number;
};

export type UtteranceMetric = {
  /** 軸3: 空返信 */
  isEmpty: boolean;
  /** 軸2: 長さ。指定があれば lengthRatio に実測/指定を入れる */
  charCount: number;
  lengthRatio: number | null;
  /** 軸1: 日本語の壊れ */
  simplifiedChars: string[];
  charClassRatio: CharClassRatio;
  /** ひらがな比率が低すぎる文は日本語として崩れとる可能性が高い */
  suspectBrokenJapanese: boolean;
  /** 軸4: 反復。直前の assistant 発話が無ければ null */
  repetition: number | null;
  /** 軸5: AI臭 */
  aiSmellHits: string[];
  metaRefusalHits: string[];
  /** 軸6: エスカレーション（1発話ぶんの強度。傾きは会話単位で出す） */
  intensity: number;
  /** 軸7: タグ漏れ */
  leakedTags: string[];
  /** 軸8: 山場を受けたか。局長の宣言に対して返事が描写したか流したか */
  climaxHandling: ClimaxHandling;
};

export type ConversationMetric = {
  utterances: UtteranceMetric[];
  /** 軸6: 強度の時系列の傾き。プラスなら登り詰めとる */
  escalationSlope: number | null;
  /** 会話の死に方。台由来かどうかの切り分けに使う */
  deathMode: "no-reply" | "empty-reply" | "alive" | "unknown";
  assistantTurns: number;
};

const HIRAGANA = /\p{Script=Hiragana}/u;
const KATAKANA = /\p{Script=Katakana}/u;
const HAN = /\p{Script=Han}/u;
const LATIN = /\p{Script=Latin}/u;
const DIGIT = /\p{Nd}/u;

/** `<response>` `<action>` など、剥がし損ねた生タグ。閉じタグも1件として数える */
const TAG_PATTERN = /<\/?[A-Z_a-z][^>]*>/g;

export function isEmptyReply(content: string): boolean {
  return content.trim() === "";
}

export function charClassRatio(content: string): CharClassRatio {
  const chars = [...content];
  const total = chars.length;
  const zero: CharClassRatio = {
    hiragana: 0,
    katakana: 0,
    kanji: 0,
    latin: 0,
    digit: 0,
    other: 0,
  };
  if (total === 0) return zero;
  const count = { ...zero };
  for (const ch of chars) {
    if (HIRAGANA.test(ch)) count.hiragana += 1;
    else if (KATAKANA.test(ch)) count.katakana += 1;
    else if (HAN.test(ch)) count.kanji += 1;
    else if (LATIN.test(ch)) count.latin += 1;
    else if (DIGIT.test(ch)) count.digit += 1;
    else count.other += 1;
  }
  return {
    hiragana: count.hiragana / total,
    katakana: count.katakana / total,
    kanji: count.kanji / total,
    latin: count.latin / total,
    digit: count.digit / total,
    other: count.other / total,
  };
}

export function detectSimplified(content: string): string[] {
  return [...content].filter((ch) => NON_JAPANESE_HAN_CHARS.has(ch));
}

export function detectLeakedTags(content: string): string[] {
  return content.match(TAG_PATTERN) ?? [];
}

export function detectPhrases(content: string, dictionary: readonly string[]): string[] {
  return dictionary.filter((phrase) => content.includes(phrase));
}

function ngrams(text: string, n: number): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i + n <= text.length; i += 1) grams.add(text.slice(i, i + n));
  return grams;
}

/** 直前発話との n-gram 重複率。短い方を分母にするので「使い回し」が素直に出る */
export function ngramOverlap(a: string, b: string, n = 5): number | null {
  const ga = ngrams(a, n);
  const gb = ngrams(b, n);
  if (ga.size === 0 || gb.size === 0) return null;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared += 1;
  return shared / Math.min(ga.size, gb.size);
}

/** 強度語彙の重み付き出現密度。1000文字あたりに正規化して長さの影響を抜く */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

export function intensityScore(content: string): number {
  if (content.length === 0) return 0;
  let sum = 0;
  for (const [words, weight] of INTENSITY_LEXICON) {
    for (const w of words) sum += countOccurrences(content, w) * weight;
  }
  return (sum / content.length) * 1000;
}

/** 最小二乗の傾き。点が2つ未満なら傾きは定義せん */
export function slope(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

// 軸8: 山場を受けたか。
// 局長判定 2026-09-01「中に出すって宣言しとるのに出されてるシーンが全然なくて、終わったことになってる」。
// 機械7軸はこれを通した。エスカレーション傾きは強度語の「出た回数」しか見とらんので、
// 宣言（局長側）を数えて描写（返事側）を数えてへんかった。

/** 局長側が「これから出す/イく」と宣言しとる合図 */
const CLIMAX_DECLARATIONS = [
  "中に出",
  "中出し",
  "出すよ",
  "出すね",
  "出すぞ",
  "出すから",
  "出る",
  "イく",
  "イくよ",
  "イきそう",
  "射精",
  "限界",
  "もう出",
] as const;

// 誤検知の記録 2026-09-01: 最初は「満たし」を描写語に入れとった。
// 「存在感が心を満たしていく」という無関係な定型句を拾って received と誤判定した。
// 汎用語は使わん。液体・部位・動きが揃うか、まぎれの無い語が出た時だけ受けたと数える。

/** これが出たら文句なしに受けとる */
const CLIMAX_UNAMBIGUOUS = [
  "白濁",
  "どくどく",
  "びゅく",
  "びゅる",
  "中出しされ",
  "注ぎ込ま",
  "流れ込ん",
  "放出さ",
  "孕ませ",
  "精液が",
  "子種を",
] as const;

// 「先輩の熱いのが…子宮まで届いて」を取りこぼした（2026-09-01 実測）。口語形も入れる
const CLIMAX_LIQUID = [
  "精液",
  "熱いの",
  "熱いもの",
  "熱い液",
  "子種",
  "遺伝子",
  "白い液",
  "粘液",
] as const;

const CLIMAX_INTERIOR = ["子宮", "膣", "腟", "最奥", "奥に", "奥へ", "中に"] as const;

const CLIMAX_MOTION = [
  "注が",
  "注ぎ",
  "届い",
  "届く",
  "流れ込",
  "広が",
  "溢れ",
  "染み",
  "叩きつけ",
  "満たされ",
  "打ちつけ",
] as const;

export type ClimaxHandling = "none" | "received" | "dodged";

/** 宣言に対して返事が受けたか流したかを返す。宣言が無ければ none */
export function detectClimaxHandling(userText: string, replyText: string): ClimaxHandling {
  const declared = CLIMAX_DECLARATIONS.some((d) => userText.includes(d));
  if (!declared) return "none";
  if (CLIMAX_UNAMBIGUOUS.some((d) => replyText.includes(d))) return "received";
  const complete =
    CLIMAX_LIQUID.some((d) => replyText.includes(d)) &&
    CLIMAX_INTERIOR.some((d) => replyText.includes(d)) &&
    CLIMAX_MOTION.some((d) => replyText.includes(d));
  return complete ? "received" : "dodged";
}

export type MeasureOptions = {
  /** この返事を引き出した局長側の発話。軸8の判定に要る */
  userText?: string;
  /** 直前の assistant 発話。反復の算出に使う */
  previousAssistant?: string;
  /** プロンプトで指定した文字数。lengthRatio の分母 */
  expectedLength?: number;
};

export function measureUtterance(content: string, options: MeasureOptions = {}): UtteranceMetric {
  const ratio = charClassRatio(content);
  const empty = isEmptyReply(content);
  return {
    isEmpty: empty,
    charCount: content.length,
    lengthRatio:
      options.expectedLength && options.expectedLength > 0
        ? content.length / options.expectedLength
        : null,
    simplifiedChars: detectSimplified(content),
    charClassRatio: ratio,
    // 日本語の地の文はひらがなが2割を切ることがまず無い。切っとったら壊れを疑う
    suspectBrokenJapanese: !empty && content.length >= 40 && ratio.hiragana < 0.2,
    repetition: options.previousAssistant ? ngramOverlap(options.previousAssistant, content) : null,
    aiSmellHits: detectPhrases(content, AI_SMELL_PHRASES),
    metaRefusalHits: detectPhrases(content, META_REFUSAL_PHRASES),
    intensity: intensityScore(content),
    leakedTags: detectLeakedTags(content),
    climaxHandling: detectClimaxHandling(options.userText ?? "", content),
  };
}

export type Turn = { role: string; content: string };

export function measureConversation(
  turns: Turn[],
  options: { expectedLength?: number } = {},
): ConversationMetric {
  const visible = turns.filter((t) => t.role !== "system");
  const utterances: UtteranceMetric[] = [];
  let previousAssistant: string | undefined;
  for (const t of visible) {
    if (t.role !== "assistant") continue;
    utterances.push(
      measureUtterance(t.content, {
        previousAssistant,
        expectedLength: options.expectedLength,
      }),
    );
    previousAssistant = t.content;
  }
  const last = visible.at(-1);
  let deathMode: ConversationMetric["deathMode"] = "alive";
  if (!last) deathMode = "unknown";
  else if (last.role === "user") deathMode = "no-reply";
  else if (last.role === "assistant" && isEmptyReply(last.content)) deathMode = "empty-reply";
  return {
    utterances,
    escalationSlope: slope(utterances.map((u) => u.intensity)),
    deathMode,
    assistantTurns: utterances.length,
  };
}
