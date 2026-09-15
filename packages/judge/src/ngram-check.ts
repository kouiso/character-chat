export type NgramResult = {
  ok: boolean;
  ratio: number;
  // 直前の塊と一字一句同じ 8 字以上の連なり（再生成の依頼文で名指しするため。最長 6 個）。
  matchedPhrases: string[];
  // 句読点・記号・空白を除いた本文が、直前の塊のどれかと完全一致（短い台詞の丸ごと再掲）。
  exactRepeat: boolean;
};

const N = 8;

// 反復判定を免除する下限（collapsed 後の文字数）。旧実装は <dialogue> 等のタグを含む生の
// 文字列長で判定しとって、タグ分（20文字前後）が下駄になり、実質どんな短い台詞も
// 反復チェックの対象外になってもうとった。タグを剥がし空白を畳んだ実質の文字数で判定する。
const MIN_REPETITION_LENGTH = 12;

const TAG_PATTERN = /<[^>]+>/g;

// タグを剥がし、空白を畳んだ「実質の文字列」。n-gram の生成にも長さ判定にも同じものを使う。
// ベンチの解析（intra-turn / cross-turn の反復計測）も同じ正規化を使うので export する。
// 解析側が別実装を持つと、ランタイムの判定と集計の母集団がズレて比較不能になる。
export const collapse = (text: string): string => text.replace(TAG_PATTERN, "").replace(/\s+/g, "");

export const toNgrams = (collapsed: string): Set<string> => {
  const grams = new Set<string>();
  for (let i = 0; i + N <= collapsed.length; i += 1) {
    grams.add(collapsed.slice(i, i + N));
  }
  return grams;
};

// 同じターンの中で 2 回以上出た n-gram の種類数。toNgrams は Set なのでターン内の
// 反復が消える（「彼女の胸は、少し……動いている」x10 が 1 gram に潰れる）。解析側が
// ランタイムと同じ正規化・同じ N でターン内反復を数えるための共有実装。
export const countRepeatedNgrams = (collapsed: string): number => {
  const counts = new Map<string, number>();
  for (let i = 0; i + N <= collapsed.length; i += 1) {
    const gram = collapsed.slice(i, i + N);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let repeated = 0;
  for (const count of counts.values()) {
    if (count >= 2) repeated += 1;
  }
  return repeated;
};

// 完全一致の判定には句読点・括弧・空白まで落とす。「…ずっとここにいて」と「ずっとここにいて。」を同じ台詞と見る。
const PUNCT_PATTERN = /[\s!(),.?…、。「」『』・ー！（）？]/g;
const normalizeForExact = (text: string): string => collapse(text).replace(PUNCT_PATTERN, "");

// 完全一致を反復と見る下限。挨拶レベルの 3 字（「うん」「はい」）は場面で自然に繰り返るので外す。
const MIN_EXACT_REPEAT_LENGTH = 4;

const MAX_MATCHED_PHRASES = 6;

// 直前の塊と共有する 8 字以上の連なりを、重ならんように最長で拾う。
const collectMatchedPhrases = (collapsed: string, previousGrams: Set<string>): string[] => {
  const phrases: string[] = [];
  let i = 0;
  while (i + N <= collapsed.length && phrases.length < MAX_MATCHED_PHRASES) {
    if (!previousGrams.has(collapsed.slice(i, i + N))) {
      i += 1;
      continue;
    }
    let end = i + N;
    while (end < collapsed.length && previousGrams.has(collapsed.slice(end - N + 1, end + 1)))
      end += 1;
    phrases.push(collapsed.slice(i, end));
    i = end;
  }
  return phrases;
};

const isExactRepeat = (text: string, previousChunks: string[]): boolean => {
  const normalized = normalizeForExact(text);
  if (normalized.length < MIN_EXACT_REPEAT_LENGTH) return false;
  return previousChunks.some((prev) => normalizeForExact(prev) === normalized);
};

const overlapRatio = (grams: Set<string>, previousGrams: Set<string>): number => {
  let overlap = 0;
  for (const gram of grams) {
    if (previousGrams.has(gram)) overlap += 1;
  }
  return grams.size === 0 ? 0 : overlap / grams.size;
};

export const ngramCheck = (text: string, previousChunks: string[]): NgramResult => {
  const collapsed = collapse(text);
  const grams = toNgrams(collapsed);
  const exactRepeat = isExactRepeat(text, previousChunks);
  const previousGrams = new Set<string>();
  for (const prev of previousChunks) {
    for (const gram of toNgrams(collapse(prev))) previousGrams.add(gram);
  }
  const ratio = overlapRatio(grams, previousGrams);
  const tooSimilar = collapsed.length >= MIN_REPETITION_LENGTH && ratio >= 0.3;
  const matchedPhrases =
    tooSimilar || exactRepeat ? collectMatchedPhrases(collapsed, previousGrams) : [];
  return { ok: !tooSimilar && !exactRepeat, ratio, matchedPhrases, exactRepeat };
};
