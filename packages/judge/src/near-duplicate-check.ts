// 文単位の言い換え反復。8 字 n-gram の比率（ngram-check）は塊全体で見るので、長い塊の中に直前の
// 一文を言い換えて置いた反復（「首筋に歯を立てる。軽く噛んで、痕を残す」→「…跡を残す」、
// 2026-09-05 CI 33942874467 の鈴 t7）を拾えん。文ごとに 2 字 gram の Jaccard で比べる。
// 旧経路の findNearDuplicateMatch（Jaccard 0.5）と同じ考え方を文の粒度に下ろしたもの。
export type NearDuplicateMatch = { sentence: string; previous: string; jaccard: number };

export type NearDuplicateResult = { ok: boolean; matches: NearDuplicateMatch[] };

const TAG_PATTERN = /<[^>]+>/g;
const SENTENCE_SPLIT = /[\n!.?。！？]+/;
const PUNCT_PATTERN = /[\s!(),.?…、。「」『』・ー！（）？]/g;

// 短い文（相槌・「…あっ」の類）は場面で自然に繰り返るので外す。
const MIN_SENTENCE_LENGTH = 10;
const JACCARD_THRESHOLD = 0.6;
const MAX_MATCHES = 4;

const normalize = (sentence: string): string => sentence.replace(PUNCT_PATTERN, "");

export const splitSentences = (text: string): string[] =>
  text
    .replace(TAG_PATTERN, "\n")
    .split(SENTENCE_SPLIT)
    .map((piece) => piece.trim())
    .filter((piece) => normalize(piece).length >= MIN_SENTENCE_LENGTH);

const bigrams = (normalized: string): Set<string> => {
  const grams = new Set<string>();
  for (let i = 0; i + 2 <= normalized.length; i += 1) grams.add(normalized.slice(i, i + 2));
  return grams;
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  const union = a.size + b.size - overlap;
  return union === 0 ? 0 : overlap / union;
};

export const nearDuplicateCheck = (text: string, previousChunks: string[]): NearDuplicateResult => {
  const previousSentences = previousChunks.flatMap(splitSentences);
  const previousGrams = previousSentences.map((sentence) => bigrams(normalize(sentence)));
  const matches: NearDuplicateMatch[] = [];
  for (const sentence of splitSentences(text)) {
    if (matches.length >= MAX_MATCHES) break;
    const grams = bigrams(normalize(sentence));
    for (const [index, prevGrams] of previousGrams.entries()) {
      const score = jaccard(grams, prevGrams);
      if (score >= JACCARD_THRESHOLD) {
        matches.push({ sentence, previous: previousSentences[index], jaccard: score });
        break;
      }
    }
  }
  return { ok: matches.length === 0, matches };
};
