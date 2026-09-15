/* eslint-disable no-console -- ベンチの出力そのもの。数字を標準出力に出すのがこの台の役目や */
import { loadCorpusFromDump } from "../src/lib/corpus.ts";
import {
  measureConversation,
  median,
  percentile,
  type UtteranceMetric,
} from "../src/lib/text-metric.ts";

// 既存バックアップに対して機械7軸を回し、計画に焼いた基準線が再現するか見る。
// API は一切叩かん（課金ゼロ）。数字がズレたら疑うのはスクリプトの側や。

export const DEFAULT_DUMP = new URL(
  "../../../.work/backups/chat-history/20260628T101036/d1-full.sql",
  import.meta.url,
).pathname;

export type Baseline = {
  assistantCount: number;
  emptyCount: number;
  medianCharsNonEmpty: number | null;
  under200: number;
  simplifiedMessages: number;
  simplifiedChars: number;
  tagLeakMessages: number;
  conversationCount: number;
  diedWithinTwoTurns: number;
  deathByBench: number;
  deathNoReply: number;
  deathEmptyReply: number;
  aiSmellHits: number;
  metaRefusalHits: number;
  repetitionMean: number | null;
  repetitionP90: number | null;
  repetitionN: number;
  escalationSlopeMedian: number | null;
  brokenJapaneseMessages: number;
};

type Accumulator = {
  assistantCount: number;
  emptyCount: number;
  under200: number;
  simplifiedMessages: number;
  simplifiedChars: number;
  tagLeakMessages: number;
  aiSmellHits: number;
  metaRefusalHits: number;
  brokenJapaneseMessages: number;
  nonEmptyLengths: number[];
  overlaps: number[];
};

function emptyAccumulator(): Accumulator {
  return {
    assistantCount: 0,
    emptyCount: 0,
    under200: 0,
    simplifiedMessages: 0,
    simplifiedChars: 0,
    tagLeakMessages: 0,
    aiSmellHits: 0,
    metaRefusalHits: 0,
    brokenJapaneseMessages: 0,
    nonEmptyLengths: [],
    overlaps: [],
  };
}

function accumulate(acc: Accumulator, u: UtteranceMetric): void {
  acc.assistantCount += 1;
  if (u.isEmpty) acc.emptyCount += 1;
  else acc.nonEmptyLengths.push(u.charCount);
  if (u.charCount < 200) acc.under200 += 1;
  if (u.simplifiedChars.length > 0) {
    acc.simplifiedMessages += 1;
    acc.simplifiedChars += u.simplifiedChars.length;
  }
  if (u.leakedTags.length > 0) acc.tagLeakMessages += 1;
  acc.aiSmellHits += u.aiSmellHits.length;
  acc.metaRefusalHits += u.metaRefusalHits.length;
  if (u.suspectBrokenJapanese) acc.brokenJapaneseMessages += 1;
  if (u.repetition !== null) acc.overlaps.push(u.repetition);
}

export function computeBaseline(sqlPath: string = DEFAULT_DUMP): Baseline {
  const corpus = loadCorpusFromDump(sqlPath);
  const acc = emptyAccumulator();
  const slopes: number[] = [];
  let diedWithinTwoTurns = 0;
  let deathNoReply = 0;
  let deathEmptyReply = 0;

  for (const turns of corpus.conversations.values()) {
    const conv = measureConversation(turns);
    if (conv.assistantTurns <= 2) diedWithinTwoTurns += 1;
    if (conv.deathMode === "no-reply") deathNoReply += 1;
    if (conv.deathMode === "empty-reply") deathEmptyReply += 1;
    if (conv.escalationSlope !== null) slopes.push(conv.escalationSlope);
    for (const u of conv.utterances) accumulate(acc, u);
  }

  return {
    assistantCount: acc.assistantCount,
    emptyCount: acc.emptyCount,
    medianCharsNonEmpty: median(acc.nonEmptyLengths),
    under200: acc.under200,
    simplifiedMessages: acc.simplifiedMessages,
    simplifiedChars: acc.simplifiedChars,
    tagLeakMessages: acc.tagLeakMessages,
    conversationCount: corpus.conversations.size,
    diedWithinTwoTurns,
    deathByBench: deathNoReply + deathEmptyReply,
    deathNoReply,
    deathEmptyReply,
    aiSmellHits: acc.aiSmellHits,
    metaRefusalHits: acc.metaRefusalHits,
    repetitionMean:
      acc.overlaps.length === 0
        ? null
        : acc.overlaps.reduce((a, b) => a + b, 0) / acc.overlaps.length,
    repetitionP90: percentile(acc.overlaps, 0.9),
    repetitionN: acc.overlaps.length,
    escalationSlopeMedian: median(slopes),
    brokenJapaneseMessages: acc.brokenJapaneseMessages,
  };
}

if (import.meta.filename === process.argv[1]) {
  const b = computeBaseline(process.argv[2] ?? DEFAULT_DUMP);
  const rows: Array<[string, string | number]> = [
    ["assistant 発話数", b.assistantCount],
    ["空返信", `${b.emptyCount} (${((b.emptyCount / b.assistantCount) * 100).toFixed(1)}%)`],
    ["空を除いた median 文字数", b.medianCharsNonEmpty ?? "-"],
    ["200字未満", b.under200],
    ["簡体字を含む発話", `${b.simplifiedMessages} (${b.simplifiedChars}文字)`],
    ["日本語崩れ疑い(ひらがな<20%)", b.brokenJapaneseMessages],
    ["生タグ残り", b.tagLeakMessages],
    ["AI臭ヒット", b.aiSmellHits],
    ["拒否・メタ発言ヒット", b.metaRefusalHits],
    [
      "反復(直前との5-gram重複)",
      `mean=${b.repetitionMean?.toFixed(3)} p90=${b.repetitionP90?.toFixed(3)} n=${b.repetitionN}`,
    ],
    ["エスカレーション傾き median", b.escalationSlopeMedian?.toFixed(3) ?? "-"],
    ["会話数", b.conversationCount],
    ["2ターン以内で終了", b.diedWithinTwoTurns],
    [
      "台由来の死に方",
      `${b.deathByBench} (返事なし ${b.deathNoReply} / 空で終了 ${b.deathEmptyReply})`,
    ],
  ];
  const width = Math.max(...rows.map(([k]) => [...k].length));
  for (const [k, v] of rows) console.log(`${k.padEnd(width, "　")}  ${v}`);
}
