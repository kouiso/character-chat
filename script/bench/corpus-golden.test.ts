// @vitest-environment node
// 実コーパスに対する golden。
//
// 初版は「.work/e2e-results/ は .gitignore 対象で CI に無い」として合成 fixture だけを
// golden にしとった。**その前提が誤りやった。**vlong-dogfood 510ファイルと
// model-ab-stage{0,1,2}.json は main に追跡済みで、CI にも在る。
// 実測値を焼いてへんかったせいで、軸を触った時に数字が黙って動く余地が残っとった。
//
// ここで固定するのは「軸を変えたら気付く」ためのもので、正しさの証明やない。
// 数字が変わること自体は悪やない。**説明せんまま変わることが悪。**
// 意図して動かした時は、この期待値と doc/bench-conditions-*.md を同時に更新すること。
//
// 2026-09-07 更新: vlong-dogfood のコーパスが 482 → 1758 ターン / 52 → 162 会話に増えた。
// 品質エンジン改修の PR が焼き足した dogfood 記録を取り込んだため。model-ab と
// bench-run は同じコーパスのままなので期待値も動いてへん。

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { measureAll } from "./axes";
import {
  loadBenchRuns,
  loadModelAbStages,
  loadVlongDogfood,
  markTurnsAfterBrokenContext,
  normalizeTurn,
} from "./corpus";
import { summarize } from "./report";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const VLONG_DIR = path.join(ROOT, ".work", "e2e-results", "vlong-dogfood");
const MODEL_AB_FILES = [0, 1, 2].map((stage) =>
  path.join(ROOT, ".work", "e2e-results", `model-ab-stage${stage}.json`),
);
const BENCH_RUNS_DIR = path.join(ROOT, ".work", "e2e-results", "bench-runs");

/**
 * **CLI と同じ前処理を通す。**`markTurnsAfterBrokenContext` を飛ばして測っとった間、
 * 壊れた文脈の後を採点し直す regression が入っても golden は全部 green のまま、
 * CLI の表だけが変わる形やった（cli.ts:151 が本番の経路）。
 */
const prepared = (turns: ReturnType<typeof normalizeTurn>[]) =>
  markTurnsAfterBrokenContext(turns);

// 実測系は全ターン走査するので、遅い GitHub-hosted runner では既定 5s を超える
const MEASURE_TIMEOUT = 120_000;

describe("実コーパスの golden（軸を触った時に気付くため）", () => {
  it("コーパスがリポジトリに在る（追跡されとる前提そのものを守る）", () => {
    expect(existsSync(VLONG_DIR)).toBe(true);
    for (const file of MODEL_AB_FILES) expect(existsSync(file)).toBe(true);
  });

  it("vlong-dogfood は 1758 ターン / 162 会話", () => {
    const turns = loadVlongDogfood(VLONG_DIR).map(normalizeTurn);
    expect(turns).toHaveLength(1758);
    expect(new Set(turns.map((t) => t.scenario)).size).toBe(162);
  });

  it("model-ab は 560 ターン / 80 会話（台本4 × モデル × 試行）", () => {
    const turns = loadModelAbStages(MODEL_AB_FILES).map(normalizeTurn);
    expect(turns).toHaveLength(560);
    expect(new Set(turns.map((t) => t.scenario)).size).toBe(80);
  });

  it("vlong-dogfood の実測値", { timeout: MEASURE_TIMEOUT }, () => {
    const summary = summarize(
      "vlong",
      measureAll(prepared(loadVlongDogfood(VLONG_DIR).map(normalizeTurn))),
    );
    expect(summary.turns).toBe(1704);
    expect(summary.medianVisibleChars).toBe(526);
    // 中断した AbortError の分。本文を出し切ってから落ちたターンは測定に残る
    expect(summary.transportError).toStrictEqual({ hits: 16, total: 1758 });
    expect(summary.empty).toStrictEqual({ hits: 0, total: 1704 });
    // 分母は 1704 やのうて 1542 — 比べる相手が居らんターン（各会話の turn1）は
    // 「反復してへん」証拠に数えん
    expect(summary.repeatLayerAware).toStrictEqual({ hits: 759, total: 1542 });
    expect(summary.repeatProduction).toStrictEqual({ hits: 621, total: 1542 });
    expect(summary.crossCheckMismatch).toStrictEqual({ hits: 17, total: 1704 });
  });

  it("model-ab の実測値 — 空返信は全部インフラ障害やった", { timeout: MEASURE_TIMEOUT }, () => {
    const summary = summarize(
      "model-ab",
      measureAll(prepared(loadModelAbStages(MODEL_AB_FILES).map(normalizeTurn))),
    );
    expect(summary.turns).toBe(479);
    expect(summary.transportError).toStrictEqual({ hits: 81, total: 560 });
    expect(summary.empty).toStrictEqual({ hits: 0, total: 479 });
    expect(summary.repeatLayerAware).toStrictEqual({ hits: 3, total: 410 });
  });

  it("bench-run（生成した run）の実測値 — 壊れた文脈の後は採点せん", { timeout: MEASURE_TIMEOUT }, () => {
    // この run が、除外の規則が効いとることを示す唯一の実証拠。golden へ入れてへんかった
    // 間は、turn6-10 を採点し直す regression が入っても全部 green のままやった
    expect(existsSync(BENCH_RUNS_DIR)).toBe(true);
    const summary = summarize(
      "bench-run",
      measureAll(prepared(loadBenchRuns(BENCH_RUNS_DIR).map(normalizeTurn))),
    );
    // 10ターン投げて、turn5 が 429。採点できるのは turn1-4
    expect(summary.turns).toBe(4);
    expect(summary.transportError).toStrictEqual({ hits: 1, total: 10 });
    expect(summary.afterBrokenContext).toBe(5);
    // 分量の指示を送っとらん run なので、床が付かん＝不足は判定せん
    expect(summary.tooShort).toStrictEqual({ hits: 0, total: 0 });
  });
});
