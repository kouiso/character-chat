import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DIVERSITY_DIRECTIVE_START,
  LATE_TURN_START,
  resolveLateTurnStrategy,
} from "./late-turn-strategy";

describe("resolveLateTurnStrategy", () => {
  it("21ターンまではモデル切替の経路を維持する", () => {
    expect(resolveLateTurnStrategy(LATE_TURN_START - 1, "conversation").isLateTurn).toBe(false);
    expect(resolveLateTurnStrategy(LATE_TURN_START, "conversation").isLateTurn).toBe(true);
  });

  // 実測(2026-08-17 phase6 の 10 ターン通し): 霜月鈴の台詞 110 行中 38 行が完全に同一で、
  // 雛形は 7 ターン目には固まっとった。22 まで待つ仕掛けは 10 ターンの通しで一度も動かん。
  // モデル切替とは別の閾値にする。片方を下げるともう片方まで動く状態やった。
  it("書き出しの多様化はモデル切替より早う始まる", () => {
    expect(DIVERSITY_DIRECTIVE_START).toBeLessThan(LATE_TURN_START);
    expect(
      resolveLateTurnStrategy(DIVERSITY_DIRECTIVE_START - 1, "erotic").diversityDirective,
    ).toBeNull();
    const early = resolveLateTurnStrategy(DIVERSITY_DIRECTIVE_START, "erotic");
    expect(early.diversityDirective).not.toBeNull();
    // 早う出しても、モデル切替の側は動かさん。
    expect(early.isLateTurn).toBe(false);
  });

  it("台詞の書き出しの反復を名指しで禁じる", () => {
    expect(resolveLateTurnStrategy(7, "erotic").diversityDirective).toContain(
      "直近 3 ターンで使った台詞の書き出しを使わない",
    );
  });

  it("conversationは話題を進める観点をローテーションする", () => {
    const first = resolveLateTurnStrategy(DIVERSITY_DIRECTIVE_START, "conversation");
    const second = resolveLateTurnStrategy(DIVERSITY_DIRECTIVE_START + 1, "conversation");
    const fifth = resolveLateTurnStrategy(DIVERSITY_DIRECTIVE_START + 4, "conversation");

    expect(first.diversityDirective).toContain("直前の話題との具体的なつながり");
    expect(first.diversityDirective).not.toContain("身体反応");
    expect(second.diversityDirective).toContain("新しい場所・物・時間帯");
    expect(fifth.diversityDirective).toBe(first.diversityDirective);
  });

  it("conversation以外の既存観点を維持する", () => {
    expect(
      resolveLateTurnStrategy(DIVERSITY_DIRECTIVE_START, "erotic").diversityDirective,
    ).toContain("音と呼吸の変化");
  });

  it("履歴trim前の全ユーザーターン数で後半ターンを判定する", () => {
    const routePath = resolve(__dirname, "../../functions/api/[[route]].ts");
    const source = readFileSync(routePath, "utf-8");

    expect(source).toContain(
      'const userTurnCount = rawMessages.filter((message) => message.role === "user").length;',
    );
    expect(source).toContain("resolveLateTurnStrategy(userTurnCount, phase)");
  });
});
