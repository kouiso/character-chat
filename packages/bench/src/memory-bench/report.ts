// RIT-96 モデル比較の報告の形。stdout・--out の JSON・doc/v2/model-compare.md の元データ。
// 本文（会話・台本の返事・記憶の中身）は一切入れん — 数・ラベル・時間だけ（FR-6）。
// このファイルは RIT-99 の memoryRecallReportSchema とも同居する（あちらは想起試験台の形）。
import { z } from "zod";

// 台本ごとの打ち切りターン。キーは script-run.ts の成人向け台本ラベルそのまま。
const stoppedAfterTurnSchema = z.object({
  Sakura: z.number().int().nullable(),
  Downer: z.number().int().nullable(),
});

const recallRunSchema = z.object({
  correct: z.number().int(),
  asked: z.number().int(),
  ratio: z.number(),
});

const distanceCountsSchema = z.object({ correct: z.number().int(), asked: z.number().int() });

const recallSectionSchema = z.object({
  // 回した回数分だけ積む（既定 2 回。失敗した回は含めん）。
  runs: z.array(recallRunSchema),
  mean: z.number(),
  // 揺れ = |1 回目の正答率 − 2 回目の正答率|。1 回しか取れんかった時は 0（測れん）。
  spread: z.number(),
  byDistance: z.object({ "50": distanceCountsSchema, "200": distanceCountsSchema }),
});

const refusalSectionSchema = z.object({
  refused: z.number().int(),
  empty: z.number().int(),
  // 実際に送ったターン数（途中打ち切りで 20 に揃わんことがあるので分母は計測値）。
  turns: z.number().int(),
  stoppedAfterTurn: stoppedAfterTurnSchema,
});

const latencySectionSchema = z.object({
  // 台本側は最初の字までの時間を取っとらんので null があり得る。
  firstChunkP50: z.number().nullable(),
  firstChunkP90: z.number().nullable(),
  totalP50: z.number(),
  totalP90: z.number(),
});

export const modelCompareRowSchema = z.object({
  model: z.string(),
  providerOnly: z.array(z.string()).nullable(),
  // providerOnly が在る時は "model [Venice]"、無い時はモデル名だけ（票の label 約束）。
  label: z.string(),
  role: z.enum(["default", "escape1", "escape2", "previous-default"]),
  status: z.enum(["ok", "unavailable"]),
  reason: z.enum(["not_found", "upstream_error", "character_missing", "aborted"]).nullable(),
  recall: recallSectionSchema.nullable(),
  refusal: refusalSectionSchema.nullable(),
  latency: latencySectionSchema.nullable(),
  estimatedUsd: z.number().nullable(),
  // 失敗した呼び出しの数（想起の失敗回・台本のエラーターンを数える）。
  failedCalls: z.number().int(),
});

export const modelCompareReportSchema = z.object({
  kind: z.literal("model-compare"),
  schemaVersion: z.literal(1),
  startedAt: z.string(),
  finishedAt: z.string(),
  gitSha: z.string(),
  rows: z.array(modelCompareRowSchema),
  // 既定が揺れを超えて正答で下回った逃げ道の label（FR-5。旧既定は比べん）。
  defaultBehind: z.array(z.string()),
  // 回す前に出した見込み費用の合計。単価が取れん時は null。
  estimatedUsdTotal: z.number().nullable(),
});

export type StoppedAfterTurn = z.infer<typeof stoppedAfterTurnSchema>;
export type ModelCompareRow = z.infer<typeof modelCompareRowSchema>;
export type ModelCompareReport = z.infer<typeof modelCompareReportSchema>;
