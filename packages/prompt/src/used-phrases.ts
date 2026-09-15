// 直前のターンで使った言い回しを拾って、次の生成の入力に「使い済み」として渡す。
// 2026-09-05 CI 33945954083（11 回目）の盲検読解: 一字一句・近い言い換えは判定で消えたが、
// 「震え」「離さないで」「太もも…ぬるり」「鎖骨に歯を立て…血の味」のように同じ語をターンをまたいで
// 別の文に散らす使い回しが残った。判定で落とすと本文が痩せるだけなので、生成の前に名指しする
// （旧経路の実測 F11: 同じ入力で書き直させると同じ写しが出る）。
const TAG_PATTERN = /<[^>]+>/g;
const PUNCT_PATTERN = /[\s!(),.?…、。「」『』・ー！（）？]/g;

// 拾う連なりの最小・最大の長さと、渡す個数の上限。system prompt の 3,000 字に収めるため。
const GRAM = 6;
const MIN_PHRASE_LENGTH = 6;
const MAX_PHRASE_LENGTH = 24;
const MAX_PHRASES = 10;

const collapse = (text: string): string => text.replace(TAG_PATTERN, "").replace(PUNCT_PATTERN, "");

const gramsOf = (collapsed: string): Set<string> => {
  const grams = new Set<string>();
  for (let i = 0; i + GRAM <= collapsed.length; i += 1) grams.add(collapsed.slice(i, i + GRAM));
  return grams;
};

// 後のターンの本文の中で、それより前のどのターンにも出とる連なりを最長で拾う。
const sharedRuns = (collapsed: string, earlierGrams: Set<string>): string[] => {
  const runs: string[] = [];
  let i = 0;
  while (i + GRAM <= collapsed.length) {
    if (!earlierGrams.has(collapsed.slice(i, i + GRAM))) {
      i += 1;
      continue;
    }
    let end = i + GRAM;
    while (
      end < collapsed.length &&
      end - i < MAX_PHRASE_LENGTH &&
      earlierGrams.has(collapsed.slice(end - GRAM + 1, end + 1))
    )
      end += 1;
    runs.push(collapsed.slice(i, end));
    i = end;
  }
  return runs;
};

// previousTexts は古い順。ターンをまたいで 2 回以上出た連なりを、長いものから最大 MAX_PHRASES 個返す。
export const collectUsedPhrases = (previousTexts: string[]): string[] => {
  const seen = new Set<string>();
  const earlier = new Set<string>();
  const found = new Set<string>();
  for (const text of previousTexts) {
    const collapsed = collapse(text);
    for (const run of sharedRuns(collapsed, earlier)) {
      if (run.length >= MIN_PHRASE_LENGTH) found.add(run);
    }
    for (const gram of gramsOf(collapsed)) earlier.add(gram);
  }
  // 長い連なりに含まれる短い連なりは重複なので落とす。
  const sorted = [...found].sort((a, b) => b.length - a.length);
  const result: string[] = [];
  for (const phrase of sorted) {
    if (result.some((kept) => kept.includes(phrase))) continue;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    result.push(phrase);
    if (result.length >= MAX_PHRASES) break;
  }
  return result;
};
