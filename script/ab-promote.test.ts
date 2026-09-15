import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateSlot,
  JUDGE_VALIDITY_PREDICATE,
  preservesChampionPhaseCoverage,
} from "./ab-promote";

describe("preservesChampionPhaseCoverage", () => {
  it("rejects a phase-limited candidate that would narrow the only champion", () => {
    expect(preservesChampionPhaseCoverage("intimate,erotic,climax,afterglow", "climax")).toBe(
      false,
    );
  });

  it("accepts an equal or broader candidate scope", () => {
    expect(preservesChampionPhaseCoverage("erotic,climax", "erotic, climax")).toBe(true);
    expect(preservesChampionPhaseCoverage("climax", "intimate,erotic,climax,afterglow")).toBe(true);
  });

  it("rejects empty champion coverage instead of treating it as vacuously safe", () => {
    expect(preservesChampionPhaseCoverage("", "climax")).toBe(false);
  });
});

describe("judge measurement validity", () => {
  it("excludes judge failures from promotion samples", () => {
    expect(JUDGE_VALIDITY_PREDICATE).toBe("judge_ran IS NOT NULL");
  });

  it("backfills existing measurements while preserving intentional fail-open behavior", () => {
    const migration = readFileSync(
      join(import.meta.dirname, "..", "drizzle", "0053_quality_measurement_judge_ran.sql"),
      "utf8",
    );
    expect(migration).toContain("ADD COLUMN judge_ran INTEGER");
    expect(migration).toContain("CASE WHEN judge_pass IS NULL THEN 0 ELSE 1 END");
  });
});

describe("evaluateSlot", () => {
  it("does not promote when champion or candidate row is missing", () => {
    const result = evaluateSlot("platform_scene", undefined, { id: "c1", version: 1 }, []);
    expect(result.promoted).toBe(false);
  });

  it("does not promote when sample counts are below MIN_SAMPLES", () => {
    const result = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      [
        { variant_id: "champ1", is_shadow: 0, total: 5, passed: 5 },
        { variant_id: "cand1", is_shadow: 1, total: 5, passed: 5 },
      ],
    );
    expect(result.promoted).toBe(false);
    if (!result.promoted) expect(result.reason).toMatch(/サンプル不足/);
  });

  it("does not promote a losing candidate even with enough samples (champion protection)", () => {
    const result = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      [
        { variant_id: "champ1", is_shadow: 0, total: 100, passed: 90 },
        { variant_id: "cand1", is_shadow: 1, total: 100, passed: 91 },
      ],
    );
    expect(result.promoted).toBe(false);
    if (!result.promoted) expect(result.reason).toMatch(/マージン未達/);
  });

  it("promotes a candidate that beats champion by the required margin with enough samples", () => {
    const result = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      [
        { variant_id: "champ1", is_shadow: 0, total: 100, passed: 70 },
        { variant_id: "cand1", is_shadow: 1, total: 100, passed: 85 },
      ],
    );
    expect(result.promoted).toBe(true);
    if (result.promoted) {
      expect(result.championId).toBe("champ1");
      expect(result.candidateId).toBe("cand1");
      expect(result.championPassRate).toBeCloseTo(0.7);
      expect(result.candidatePassRate).toBeCloseTo(0.85);
    }
  });

  it("treats a variant with zero measurement rows as zero samples, not undefined-crash", () => {
    const result = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      [{ variant_id: "champ1", is_shadow: 0, total: 100, passed: 90 }],
    );
    expect(result.promoted).toBe(false);
    if (!result.promoted) expect(result.reason).toMatch(/サンプル不足/);
  });

  it("accepts explicit minSamples/margin overrides instead of only module defaults", () => {
    const measurements = [
      { variant_id: "champ1", is_shadow: 0, total: 5, passed: 4 },
      { variant_id: "cand1", is_shadow: 1, total: 5, passed: 5 },
    ];
    // モジュールの意図した既定値(MIN_SAMPLES=20, MARGIN=0.1)を明示的に注入する。
    // 引数省略でモジュールレベル定数(process.env由来)に依存させると、実行環境に
    // AB_PROMOTE_MIN_SAMPLES等が設定されている場合にこのテストが環境依存で壊れる(実PR#803レビューで発見)。
    const withDefaults = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      measurements,
      20,
      0.1,
    );
    expect(withDefaults.promoted).toBe(false);

    // 明示的にminSamples=3を注入すると同じ測定データで昇格できる
    const withOverride = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      measurements,
      3,
      0.1,
    );
    expect(withOverride.promoted).toBe(true);
  });

  // minSamples=0を明示指定した場合、実測サンプル0件の変種を"サンプル不足なし"として
  // 通過させNaN比較で誤ってpromoted:trueになるバグがあった(実PR#803レビューで発見)。
  it("never promotes when either variant has zero measurement rows, even with minSamples=0", () => {
    const result = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      [],
      0,
      0.1,
    );
    expect(result.promoted).toBe(false);
    if (!result.promoted) expect(result.reason).toMatch(/サンプル不足/);
  });

  // 上のテストは champion/candidate 両方が0件のケースのみを検証していたため、
  // 片側だけ0件のケースも固定する(実PR#803レビューで発見)。
  it("never promotes when only the champion has zero measurement rows, even with minSamples=0", () => {
    const result = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      [{ variant_id: "cand1", is_shadow: 1, total: 10, passed: 10 }],
      0,
      0.1,
    );
    expect(result.promoted).toBe(false);
    if (!result.promoted) expect(result.reason).toMatch(/サンプル不足/);
  });

  it("never promotes when only the candidate has zero measurement rows, even with minSamples=0", () => {
    const result = evaluateSlot(
      "platform_scene",
      { id: "champ1", version: 1 },
      { id: "cand1", version: 2 },
      [{ variant_id: "champ1", is_shadow: 0, total: 10, passed: 10 }],
      0,
      0.1,
    );
    expect(result.promoted).toBe(false);
    if (!result.promoted) expect(result.reason).toMatch(/サンプル不足/);
  });
});
