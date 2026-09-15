import { describe, expect, it } from "vitest";

import { parseClaudeJudgeVerdict } from "../[[route]]";

describe("parseClaudeJudgeVerdict", () => {
  it("accepts the exact PASS verdict", () => {
    expect(parseClaudeJudgeVerdict("PASS")).toEqual({ pass: true });
  });

  it("accepts a well-formed FAIL verdict", () => {
    expect(parseClaudeJudgeVerdict("FAIL:EXPLICIT:具体的な描写が不足している")).toEqual({
      pass: false,
      reason: "claude-judge: 具体的な描写が不足している",
      category: "other",
      failedCheck: "claude-judge:EXPLICIT",
    });
  });

  it("accepts multiple known failure criteria", () => {
    expect(
      parseClaudeJudgeVerdict("FAIL:DIFFERENT, CHARACTER:前回と同じ表現で口調も崩れている"),
    ).toEqual({
      pass: false,
      reason: "claude-judge: 前回と同じ表現で口調も崩れている",
      category: "other",
      failedCheck: "claude-judge:DIFFERENT,CHARACTER",
    });
  });

  // 敵対レビュー #1236 指摘・5巡目: SENSORY だけ汎用の"other"のままやと、
  // quality-retry-hints.ts が抽象描写を具体化させる sensual_abstract 専用ヒント
  // （決定的側のcheckSensualSpecificity不合格と同じ文言）を出さず、判定が指摘した
  // 「抽象語のまま」を直させる指示が抜けたまま撮り直しになっていた。
  it("routes a SENSORY-only verdict to the sensual_abstract retry category", () => {
    expect(
      parseClaudeJudgeVerdict("FAIL:SENSORY:「気持ちいい」の反復だけで具体描写が無い"),
    ).toEqual({
      pass: false,
      reason: "claude-judge: 「気持ちいい」の反復だけで具体描写が無い",
      category: "sensual_abstract",
      failedCheck: "claude-judge:SENSORY",
    });
  });

  it("routes a combined SENSORY+DIFFERENT verdict to sensual_abstract too", () => {
    const result = parseClaudeJudgeVerdict("FAIL:SENSORY,DIFFERENT:抽象的で前回と同じ表現");
    expect(result?.category).toBe("sensual_abstract");
  });

  it("keeps non-SENSORY verdicts on the generic other category", () => {
    const result = parseClaudeJudgeVerdict("FAIL:DIFFERENT:前回と同じ表現");
    expect(result?.category).toBe("other");
  });

  // #1383: world-consistency / PLAUSIBLE 判定を追加し、リトライカテゴリへ回す。
  it("routes a PLAUSIBLE verdict to the world_consistency retry category", () => {
    expect(
      parseClaudeJudgeVerdict("FAIL:PLAUSIBLE:夜行バスなのに路線バスの風景が混じっている"),
    ).toEqual({
      pass: false,
      reason: "claude-judge: 夜行バスなのに路線バスの風景が混じっている",
      category: "world_consistency",
      failedCheck: "claude-judge:PLAUSIBLE",
    });
  });

  it("routes a combined PLAUSIBLE+EXPLICIT verdict to world_consistency", () => {
    const result = parseClaudeJudgeVerdict("FAIL:PLAUSIBLE,EXPLICIT:場所が矛盾しており描写も曖昧");
    expect(result?.category).toBe("world_consistency");
    expect(result?.failedCheck).toBe("claude-judge:PLAUSIBLE,EXPLICIT");
  });

  it.each([
    "",
    "MAYBE",
    "PASS because all criteria passed",
    "FAIL:",
    "FAIL:EXPLICIT:",
    "FAIL:UNKNOWN:判定基準が不明",
    // AGENCY は「受動的な反応 = 不合格」を決め打ちする基準やったので廃止した
    "FAIL:AGENCY:主体性がない",
    "FAIL:EXPLICIT",
    "FAIL:EXPLICIT:途中で\n切れた",
    "FAIL:PLAUSIBLE",
    "FAIL:PLAUSIBLE:",
  ])("rejects an invalid or truncated verdict: %j", (verdict) => {
    expect(parseClaudeJudgeVerdict(verdict)).toBeNull();
  });
});
