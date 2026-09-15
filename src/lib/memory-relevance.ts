export type MemoryNoteInput = {
  id: string;
  content: string;
  createdAt: number;
  lastUsedAt: number | null;
  usageCount: number;
};

export type MemoryRelevanceContext = {
  recentMessagesText: string;
  scenePhase?: "conversation" | "intimate" | "erotic" | "climax" | "afterglow";
  characterName: string;
  now: number;
};

const PHASE_TOKENS = {
  conversation: ["話", "聞", "会話", "笑"],
  intimate: ["近", "好き", "触れ", "抱", "ぬくもり"],
  erotic: ["肌", "胸", "唇", "息", "熱"],
  // 「果て」は「果てしない」を拾うので入れん。記憶の重み付けに雑音が乗る。
  climax: ["イク", "絶頂", "震え", "頂", "限界"],
  afterglow: ["余韻", "眠", "抱きしめ", "落ち着"],
} as const;

const TWO_WEEKS_MS = 1000 * 60 * 60 * 24 * 14;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const CJK_CHAR = /[ぁ-んァ-ヶ一-龠々]/u;
const WORD_RUN = /[\p{L}\p{N}]+/gu;

const tokenize = (text: string): string[] =>
  (text.toLowerCase().match(WORD_RUN) ?? []).flatMap((token) => {
    const chars = Array.from(token);
    return chars.some((char) => CJK_CHAR.test(char)) ? chars : [token];
  });

const toBigrams = (tokens: string[]): Set<string> => {
  const bigrams = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.add(`${tokens[index]}\u0000${tokens[index + 1]}`);
  }
  return bigrams;
};

const getKeywordMatch = (noteContent: string, recentMessagesText: string): number => {
  const noteBigrams = toBigrams(tokenize(noteContent));
  const contextBigrams = toBigrams(tokenize(recentMessagesText));
  if (noteBigrams.size === 0 || contextBigrams.size === 0) return 0;

  let overlap = 0;
  for (const bigram of noteBigrams) {
    if (contextBigrams.has(bigram)) overlap += 1;
  }

  return clamp01(overlap / noteBigrams.size);
};

const getPhaseFit = (content: string, scenePhase: MemoryRelevanceContext["scenePhase"]): number => {
  if (!scenePhase) return 0.3;
  const tokens = PHASE_TOKENS[scenePhase];
  return tokens.some((token) => content.includes(token)) ? 1 : 0.3;
};

const HIRAGANA_ONLY = /^[ぁ-んー]+$/u;

// 呼び出し側は直近メッセージを改行で連ねて渡す（buildRecentMessagesText /
// formatSuggestionHistory）。語を全体から取ると、前の往復の話題が今の検索語に混ざる。
// 検索したいのは「いま書かれたばかりの話題」なので、最後の行だけを見る。
const takeLatestMessage = (text: string): string => {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line) return line;
  }
  return "";
};

// ひらがなだけの2文字は「です」「した」「てる」等の活用語尾で、話題を持たん。
// ほぼ全ノートに LIKE で当たるので、残すと候補の絞り込みが効かんようになる。
const toTopicBigrams = (chars: string[]): string[] => {
  const bigrams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    const bigram = `${chars[index]}${chars[index + 1]}`;
    if (!HIRAGANA_ONLY.test(bigram)) bigrams.push(bigram);
  }
  return bigrams;
};

// D1 側の LIKE 検索へ渡す語を今の turn から切り出す。日本語は語の境界が無いので
// 2文字のかたまりで切る。1文字やと「の」「は」がほぼ全ノートに当たって候補を絞れん。
// 語は LIKE のパターンではなくバインド値として使う前提（ワイルドカードは呼び出し側が付ける）。
export const extractMemoryQueryTerms = (text: string, limit = 12): string[] => {
  const terms: string[] = [];
  for (const run of takeLatestMessage(text).toLowerCase().match(WORD_RUN) ?? []) {
    const chars = Array.from(run);
    if (chars.some((char) => CJK_CHAR.test(char))) {
      terms.push(...toTopicBigrams(chars));
      continue;
    }
    // 1文字のラテン語（a, I 等）は雑音にしかならんので落とす。
    if (chars.length >= 2) terms.push(run);
  }
  // 溢れた時は末尾を残す。同じ発話の中では、末尾ほど今の話題に近い。
  return [...new Set(terms)].slice(-limit);
};

export const scoreMemoryNote = (note: MemoryNoteInput, ctx: MemoryRelevanceContext): number => {
  const elapsed = Math.max(0, ctx.now - note.createdAt);
  const recency = clamp01(Math.exp(-elapsed / TWO_WEEKS_MS));
  const keywordMatch = getKeywordMatch(note.content, ctx.recentMessagesText);
  const phaseFit = getPhaseFit(note.content, ctx.scenePhase);
  const overusePenalty = Math.min(1, note.usageCount / 30);

  return clamp01(0.4 * recency + 0.4 * keywordMatch + 0.1 * phaseFit + 0.1 * (1 - overusePenalty));
};

export const selectRelevantMemories = (
  notes: MemoryNoteInput[],
  ctx: MemoryRelevanceContext,
  limit = 8,
): MemoryNoteInput[] =>
  [...notes]
    .sort((left, right) => {
      const scoreDiff = scoreMemoryNote(right, ctx) - scoreMemoryNote(left, ctx);
      if (scoreDiff !== 0) return scoreDiff;
      return right.createdAt - left.createdAt;
    })
    .slice(0, Math.max(0, limit));
