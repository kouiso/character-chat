#!/usr/bin/env tsx
/**
 * prompt_variant 昇格ジョブ(P4)
 *
 * slot ごとに quality_measurement を集計し、candidate の judge-pass 率が
 * champion を十分なサンプル数＋マージンで上回ったら champion を retired にして
 * candidate を champion へ昇格し、promotion_log に根拠を残す。
 *
 * champion保護: サンプル不足・マージン未達では絶対に昇格しない(負け候補はchampionを壊さない)。
 *
 * Usage:
 *   tsx script/ab-promote.ts        -- local D1 に対して判定
 *   tsx script/ab-promote.ts --remote -- prod D1 に対して判定(cron想定)
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DB_NAME = "adult-ai-db";
const isRemote = process.argv.includes("--remote");

// 最低サンプル数・マージンは環境変数で調整可能にする(本番運用で閾値をチューニングするため)。
// Number.isFinite(parseInt(...)) だけだと "-1"/"3.9"/"0.1junk" 等も通ってしまう
// (負のmarginはcandidateがchampionより低いpass rateでも昇格可能にしてしまう危険な入力)。
// 空文字を除外したうえで、minSamplesは非負整数・marginは[0,1]の範囲であることを検証する(実PR#803レビューで発見)。
const rawMinSamples = process.env.AB_PROMOTE_MIN_SAMPLES?.trim() ?? "";
const parsedMinSamples = Number(rawMinSamples);
const MIN_SAMPLES =
  rawMinSamples !== "" && Number.isInteger(parsedMinSamples) && parsedMinSamples >= 0
    ? parsedMinSamples
    : 20;
const rawMargin = process.env.AB_PROMOTE_MARGIN?.trim() ?? "";
const parsedMargin = Number(rawMargin);
const MARGIN =
  rawMargin !== "" && Number.isFinite(parsedMargin) && parsedMargin >= 0 && parsedMargin <= 1
    ? parsedMargin
    : 0.1;

// wrangler d1 execute --command はダブルクォートのみエスケープしても $() やバッククォート等の
// シェルメタ文字を無害化できない。--file 経由(script/seed.tsと同じ方式)にしてシェル解釈を回避する。
// さらにexecFileSync+引数配列でシェルそのものを経由させず、DB_NAME/flag/tmpFileが
// コマンド文字列へ補間される余地を無くす(実PR#803レビューで発見)。
function wranglerQuery<T>(sql: string): T[] {
  const flag = isRemote ? "--remote" : "--local";
  const tmpFile = join(import.meta.dirname, `.ab-promote-query-${crypto.randomUUID()}.sql`);
  writeFileSync(tmpFile, sql, "utf-8");
  try {
    // 認証失敗やwrangler側の停止で昇格ジョブ全体が無期限に止まらないようtimeoutを設ける(実PR#803レビューで発見)。
    const out = execFileSync(
      "npx",
      ["wrangler", "d1", "execute", DB_NAME, flag, "--json", "--file", tmpFile],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
      },
    );
    const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
    return parsed[0]?.results ?? [];
  } finally {
    unlinkSync(tmpFile);
  }
}

function sqlEscape(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

type VariantRow = { id: string; version: number };
type ScopedVariantRow = VariantRow & { phase_scope: string };
type MeasurementAgg = { variant_id: string; is_shadow: number; total: number; passed: number };

// deterministic かつ (judge意図的skip or judge合格) を "実質PASS" とみなす。
// judge_ran=NULL(API障害)の行はWHERE句で集計対象から除外する。
const PASS_EXPR =
  "SUM(CASE WHEN deterministic_pass = 1 AND (judge_ran = 0 OR judge_pass = 1) THEN 1 ELSE 0 END)";
export const JUDGE_VALIDITY_PREDICATE = "judge_ran IS NOT NULL";

const parsePhaseScope = (phaseScope: string): Set<string> =>
  new Set(
    phaseScope
      .split(",")
      .map((phase) => phase.trim())
      .filter(Boolean),
  );

// slot単位でchampionが1件しか存在できない現行schemaでは、candidateへの昇格で
// championの対応phaseを狭めると、未対応phaseがfallbackになって測定不能へ陥る。
// candidateが現championの全phaseを引き継ぐ場合だけ昇格を許可する。
export const preservesChampionPhaseCoverage = (
  championPhaseScope: string,
  candidatePhaseScope: string,
): boolean => {
  const championPhases = parsePhaseScope(championPhaseScope);
  const candidatePhases = parsePhaseScope(candidatePhaseScope);
  return (
    championPhases.size > 0 && [...championPhases].every((phase) => candidatePhases.has(phase))
  );
};

export type PromotionDecision =
  | {
      promoted: true;
      slot: string;
      championId: string;
      candidateId: string;
      championPassRate: number;
      candidatePassRate: number;
      championSamples: number;
      candidateSamples: number;
      decision: string;
    }
  | { promoted: false; slot: string; reason: string };

export function evaluateSlot(
  slot: string,
  championRow: VariantRow | undefined,
  candidateRow: VariantRow | undefined,
  measurements: MeasurementAgg[],
  minSamples: number = MIN_SAMPLES,
  margin: number = MARGIN,
): PromotionDecision {
  if (!championRow || !candidateRow) {
    return { promoted: false, slot, reason: "champion または candidate 行が存在しない" };
  }
  const championMeasure = measurements.find(
    (m) => m.variant_id === championRow.id && m.is_shadow === 0,
  );
  const candidateMeasure = measurements.find(
    (m) => m.variant_id === candidateRow.id && m.is_shadow === 1,
  );
  const championSamples = championMeasure?.total ?? 0;
  const candidateSamples = candidateMeasure?.total ?? 0;
  // minSamples=0 を明示指定した場合でも実測サンプル0件は常に拒否する。0件のままだと
  // 後続のpassRate計算が0/0=NaNになり、NaNとの比較は常にfalseになるため
  // 「マージン未達」判定をすり抜けてpromoted:trueになってしまう(実PR#803レビューで発見)。
  if (
    championSamples === 0 ||
    candidateSamples === 0 ||
    championSamples < minSamples ||
    candidateSamples < minSamples
  ) {
    return {
      promoted: false,
      slot,
      reason: `サンプル不足(champion=${championSamples}, candidate=${candidateSamples}, 必要=${minSamples})`,
    };
  }
  const championPassRate = (championMeasure?.passed ?? 0) / championSamples;
  const candidatePassRate = (candidateMeasure?.passed ?? 0) / candidateSamples;
  if (candidatePassRate < championPassRate + margin) {
    return {
      promoted: false,
      slot,
      reason: `マージン未達(candidate=${(candidatePassRate * 100).toFixed(1)}%, champion=${(championPassRate * 100).toFixed(1)}%, 必要マージン=${(margin * 100).toFixed(0)}pt)`,
    };
  }
  const decision = `promoted: candidate pass rate ${(candidatePassRate * 100).toFixed(1)}% (n=${candidateSamples}) >= champion ${(championPassRate * 100).toFixed(1)}% (n=${championSamples}) + margin ${(margin * 100).toFixed(0)}pt`;
  return {
    promoted: true,
    slot,
    championId: championRow.id,
    candidateId: candidateRow.id,
    championPassRate,
    candidatePassRate,
    championSamples,
    candidateSamples,
    decision,
  };
}

// D1はwrangler CLI経由の複数文を単一transactionにまとめない(BEGIN/COMMIT非対応)し、
// このscriptはstandalone Node CLIとして動くためenv.DB.batch()(D1唯一の原子的経路、Worker実行時のみ到達可能)にも
// アクセスできない。真のatomicityは達成できない。
//
// 「candidateを先にchampionへ昇格→旧championをretire」の順で「champion不在の瞬間を作らない」ことを
// 狙ったが、実機検証(E2E)で prompt_variant_slot_champion_unique_idx (同一slotに2つ目のchampionを
// 許さない部分ユニークインデックス) と真っ向から衝突することが判明した: 旧championがまだ
// status='champion'のまま残っている間は、candidateを同じslotでchampionへ更新しようとした時点で
// UNIQUE constraint failedになり、1文目から失敗する。つまりこの順序は index 導入後は原理的に成立しない。
//
// そのため旧championをretireしてから候補を昇格する順序に戻す。これは「途中失敗でchampion不在に
// なりうる」というDevin/CodeRabbitの指摘そのものへ逆戻りするが、一意インデックスと両立する唯一の順序であり、
// 万一2文目が失敗した場合はslotが一時的にchampion不在になる(既存championはretired済み)。
// この残存リスクは「standalone scriptからD1の真のatomicityに到達できない」という技術的制約に起因し、
// このPRのスコープでは解消しない — 運用上は ab:promote 実行後に champion 不在slotが無いか
// (`SELECT slot FROM prompt_variant GROUP BY slot HAVING SUM(status='champion')=0`)を
// 監視することで検知・手動復旧する前提とする。
function applyPromotion(decision: Extract<PromotionDecision, { promoted: true }>): void {
  const now = Date.now();
  wranglerQuery(
    `UPDATE prompt_variant SET status = 'retired' WHERE id = ${sqlEscape(decision.championId)};`,
  );
  wranglerQuery(
    `UPDATE prompt_variant SET status = 'champion' WHERE id = ${sqlEscape(decision.candidateId)};`,
  );
  wranglerQuery(
    `INSERT INTO promotion_log (id, slot, from_variant_id, to_variant_id, champion_samples, candidate_samples, champion_pass_rate, candidate_pass_rate, decision, decided_at) VALUES (${sqlEscape(crypto.randomUUID())}, ${sqlEscape(decision.slot)}, ${sqlEscape(decision.championId)}, ${sqlEscape(decision.candidateId)}, ${decision.championSamples}, ${decision.candidateSamples}, ${decision.championPassRate}, ${decision.candidatePassRate}, ${sqlEscape(decision.decision)}, ${now});`,
  );
}

function runAbPromote(): void {
  const slotRows = wranglerQuery<{ slot: string }>(
    `SELECT DISTINCT slot FROM prompt_variant WHERE status IN ('champion', 'candidate');`,
  );

  for (const { slot } of slotRows) {
    const championRow = wranglerQuery<ScopedVariantRow>(
      `SELECT id, version, phase_scope FROM prompt_variant WHERE slot = ${sqlEscape(slot)} AND status = 'champion' ORDER BY version DESC LIMIT 1;`,
    )[0];
    const candidateRow = wranglerQuery<ScopedVariantRow>(
      `SELECT id, version, phase_scope FROM prompt_variant WHERE slot = ${sqlEscape(slot)} AND status = 'candidate' ORDER BY version DESC LIMIT 1;`,
    )[0];
    if (!championRow || !candidateRow) {
      console.info(`[ab-promote] slot=${slot}: champion/candidate 揃わず skip`);
      continue;
    }
    if (!preservesChampionPhaseCoverage(championRow.phase_scope, candidateRow.phase_scope)) {
      console.info(
        `[ab-promote] slot=${slot}: not promoted — candidate phase_scope=${candidateRow.phase_scope} does not preserve champion coverage=${championRow.phase_scope}`,
      );
      continue;
    }

    // candidateのphase_scopeに含まれるphaseだけでchampion/candidate両方を集計する。
    // champion本来のphase_scopeはcandidateより広いことが多く(例: champion=全phase, candidate=climaxのみ)、
    // フィルタなしだとchampionのpass率が異なる母集団で計算され、公平な比較にならない。
    const phases = candidateRow.phase_scope
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const phaseInClause = phases.map((p) => sqlEscape(p)).join(", ");
    const measurements = wranglerQuery<MeasurementAgg>(
      `SELECT variant_id, is_shadow, COUNT(*) as total, ${PASS_EXPR} as passed FROM quality_measurement WHERE slot = ${sqlEscape(slot)} AND variant_id IN (${sqlEscape(championRow.id)}, ${sqlEscape(candidateRow.id)}) AND phase IN (${phaseInClause}) AND ${JUDGE_VALIDITY_PREDICATE} GROUP BY variant_id, is_shadow;`,
    );

    const result = evaluateSlot(slot, championRow, candidateRow, measurements);
    if (result.promoted) {
      applyPromotion(result);
      console.info(
        `[ab-promote] slot=${slot}: PROMOTED ${result.candidateId} over ${result.championId} — ${result.decision}`,
      );
    } else {
      console.info(`[ab-promote] slot=${slot}: not promoted — ${result.reason}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAbPromote();
}
