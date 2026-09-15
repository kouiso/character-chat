import { median, percentile } from "./text-metric.ts";

import type { TurnRecord } from "./bench.ts";

// 機械7軸を run 単位で集計する。ここに主観は入れん。「抜けたか」は P5 の人間1軸。

export type Score = {
  runId: string;
  scenarioId: string;
  model: string;
  turns: number;
  /** 軸3 */
  emptyCount: number;
  emptyRate: number;
  /** 軸2 */
  medianChars: number | null;
  medianLengthRatio: number | null;
  under200: number;
  /** 前半後半の中央値。尻すぼみはここに出る */
  firstHalfMedian: number | null;
  secondHalfMedian: number | null;
  /** 軸1 */
  simplifiedMessages: number;
  brokenJapaneseMessages: number;
  /** 軸4 */
  repetitionMean: number | null;
  repetitionP90: number | null;
  /** 軸5 */
  aiSmellHits: number;
  metaRefusalHits: number;
  /** 軸6 */
  escalationSlope: number | null;
  /** 軸7 */
  tagLeakMessages: number;
  /** 軸8: 山場。宣言されたのに描かんかった回数 */
  climaxDeclared: number;
  climaxDodged: number;
  /** 台の健康。空返信の原因切り分けに要る */
  httpErrors: number;
  truncatedByMaxTokens: number;
  /** HTTP 200 やのに本文が空で、推論チャネルだけ埋まっとった件数 */
  emptyByReasoning: number;
  latencyMedianMs: number | null;
  latencyP90Ms: number | null;
  headerMedianMs: number | null;
  completionTokensMedian: number | null;
};

function lsq(values: number[]): number | null {
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

export function scoreRun(records: TurnRecord[]): Score {
  const sorted = [...records].sort((a, b) => a.turnIndex - b.turnIndex);
  const first = sorted[0];
  const lengths = sorted.map((r) => r.metric.charCount);
  const nonEmpty = sorted.filter((r) => !r.metric.isEmpty);
  const half = Math.floor(sorted.length / 2);
  const repetitions = sorted.map((r) => r.metric.repetition).filter((v): v is number => v !== null);
  const latencies = sorted.map((r) => r.latencyMs);
  return {
    runId: first?.runId ?? "",
    scenarioId: first?.scenarioId ?? "",
    model: first?.model ?? "",
    turns: sorted.length,
    emptyCount: sorted.length - nonEmpty.length,
    emptyRate: sorted.length ? (sorted.length - nonEmpty.length) / sorted.length : 0,
    medianChars: median(nonEmpty.map((r) => r.metric.charCount)),
    medianLengthRatio: median(
      nonEmpty.map((r) => r.metric.lengthRatio).filter((v): v is number => v !== null),
    ),
    under200: lengths.filter((l) => l < 200).length,
    firstHalfMedian: median(lengths.slice(0, half)),
    secondHalfMedian: median(lengths.slice(half)),
    simplifiedMessages: sorted.filter((r) => r.metric.simplifiedChars.length > 0).length,
    brokenJapaneseMessages: sorted.filter((r) => r.metric.suspectBrokenJapanese).length,
    repetitionMean:
      repetitions.length === 0 ? null : repetitions.reduce((a, b) => a + b, 0) / repetitions.length,
    repetitionP90: percentile(repetitions, 0.9),
    aiSmellHits: sorted.reduce((a, r) => a + r.metric.aiSmellHits.length, 0),
    metaRefusalHits: sorted.reduce((a, r) => a + r.metric.metaRefusalHits.length, 0),
    escalationSlope: lsq(sorted.map((r) => r.metric.intensity)),
    tagLeakMessages: sorted.filter((r) => r.metric.leakedTags.length > 0).length,
    climaxDeclared: sorted.filter((r) => r.metric.climaxHandling !== "none").length,
    climaxDodged: sorted.filter((r) => r.metric.climaxHandling === "dodged").length,
    httpErrors: sorted.filter((r) => !r.ok).length,
    truncatedByMaxTokens: sorted.filter((r) => r.finishReason === "length").length,
    emptyByReasoning: sorted.filter((r) => r.ok && r.metric.isEmpty && (r.reasoningChars ?? 0) > 0)
      .length,
    latencyMedianMs: median(latencies),
    latencyP90Ms: percentile(latencies, 0.9),
    headerMedianMs: median(sorted.map((r) => r.headerMs ?? 0)),
    completionTokensMedian: median(
      sorted.map((r) => r.completionTokens).filter((v): v is number => v !== null),
    ),
  };
}

export function groupRuns(records: TurnRecord[]): Map<string, TurnRecord[]> {
  const out = new Map<string, TurnRecord[]>();
  for (const r of records) {
    const list = out.get(r.runId);
    if (list) list.push(r);
    else out.set(r.runId, [r]);
  }
  return out;
}

export function formatScore(s: Score): string {
  const n = (v: number | null, d = 1) => (v === null ? "-" : v.toFixed(d));
  return [
    `run=${s.runId} model=${s.model} turns=${s.turns}`,
    `  空返信      ${s.emptyCount} (${(s.emptyRate * 100).toFixed(1)}%)  うち推論で使い切り ${s.emptyByReasoning}  httpエラー ${s.httpErrors}  max_tokens打ち切り ${s.truncatedByMaxTokens}`,
    `  長さ        median ${n(s.medianChars, 0)}字 (指定比 ${n(s.medianLengthRatio, 2)})  200字未満 ${s.under200}`,
    `  尻すぼみ    前半 ${n(s.firstHalfMedian, 0)}字 → 後半 ${n(s.secondHalfMedian, 0)}字`,
    `  日本語崩れ  簡体字 ${s.simplifiedMessages}件  ひらがな不足 ${s.brokenJapaneseMessages}件`,
    `  反復        mean ${n(s.repetitionMean, 3)}  p90 ${n(s.repetitionP90, 3)}`,
    `  AI臭        ${s.aiSmellHits}件  拒否・メタ ${s.metaRefusalHits}件`,
    `  エスカレ    傾き ${n(s.escalationSlope, 3)}`,
    `  タグ漏れ    ${s.tagLeakMessages}件`,
    `  山場        宣言 ${s.climaxDeclared}回 → 流した ${s.climaxDodged}回`,
    `  レイテンシ  median ${n(s.latencyMedianMs, 0)}ms  p90 ${n(s.latencyP90Ms, 0)}ms  (ヘッダーまで ${n(s.headerMedianMs, 0)}ms)  出力tok median ${n(s.completionTokensMedian, 0)}`,
  ].join("\n");
}
