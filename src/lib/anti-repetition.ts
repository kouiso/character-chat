// 直近ターンで使ったフレーズを抽出し、次ターンの避けるべき語彙リストを生成する

const BASE_VOCABULARY_EXCLUSIONS = new Set([
  "いく",
  "いって",
  "気持ちいい",
  "気持いい",
  "もっと",
  "止まらない",
  "声が",
  "息が",
  "体が",
  "腰が",
  "感じ",
  "だめ",
  "やばい",
]);

const MINIMUM_PHRASE_LENGTH = 6;
const MAXIMUM_PHRASE_LENGTH = 20;
const MAX_EXTRACTED_PHRASES = 5;

// 日本語テキストから特徴的な名詞句・動詞句を抽出する
const extractDistinctivePhrases = (text: string): string[] => {
  const stripped = text.replace(/<[^>]+>/g, " ").replace(/[「」『』]/g, "");

  // ひらがな・カタカナ・漢字の6-20文字列を抽出（全角スペース・句読点 U+3000-303F は除外）
  const candidates = stripped.match(/[々぀-ヿ一-鿿]{6,20}/g) ?? [];

  return candidates.filter((phrase) => {
    if (BASE_VOCABULARY_EXCLUSIONS.has(phrase)) return false;
    // 漢字が1文字以上含まれること（特定性の確保）
    const hasKanji = /[一-鿿]/.test(phrase);
    if (!hasKanji) return false;
    if (phrase.length < MINIMUM_PHRASE_LENGTH) return false;
    if (phrase.length > MAXIMUM_PHRASE_LENGTH) return false;
    return true;
  });
};

export const buildAntiRepetitionMessage = (recentAssistantMessages: string[]): string | null => {
  if (recentAssistantMessages.length === 0) return null;

  const recent = recentAssistantMessages.slice(-5);

  const allPhrases: string[] = [];
  for (const msg of recent) {
    const phrases = extractDistinctivePhrases(msg);
    allPhrases.push(...phrases);
  }

  const unique = [...new Set(allPhrases)].slice(0, MAX_EXTRACTED_PHRASES);

  if (unique.length === 0) return null;

  return `[ANTI-REPETITION] 直近のターンで印象が残っているフレーズ: ${unique.join("、")}。キャラクター本人の声を保ちつつ、別の語彙・構造・比喩で新しい反応として書くこと。`;
};
