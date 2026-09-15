import { describe, expect, it } from "vitest";

import { summarizeFreshness, type Turn } from "./vlong-dogfood-recheck";

// 手で数えると毎回違う数え方になるので固定する（matrix-report.ts と同じ理由）。
// 可視文字だけ見とると、前ターンの節を貼り直した本文が長さで勝ってまう。

const CLAUSE_A = "きみの手がわたしの腰を引き寄せた";
const CLAUSE_B = "指先が背中の窪みをゆっくりとなぞった";
const CLAUSE_C = "奥を押し広げられるたび粘つく音が鳴った";

const buildTurn = (index: number, servedPhase: string, clauses: readonly string[]): Turn => {
  const body = `<response><action>${clauses.join("。")}。</action></response>`;
  const visibleChars = clauses.join("").length + clauses.length;
  return { character: "Sakura", index, servedPhase, visibleChars, innerChars: 0, body };
};

describe("summarizeFreshness", () => {
  it("前ターンの節をそのまま貼り直した分は新しい中身に数えん", () => {
    const turns = [
      buildTurn(1, "erotic", [CLAUSE_A, CLAUSE_B]),
      buildTurn(2, "erotic", [CLAUSE_A, CLAUSE_B]),
    ];
    const row = summarizeFreshness(turns, ["erotic"]);
    expect(row.recycled).toBeGreaterThan(0.4);
    expect(row.fresh).toBeLessThan(row.visible);
  });

  it("重ならん本文は目減りせん", () => {
    const turns = [
      buildTurn(1, "erotic", [CLAUSE_A]),
      buildTurn(2, "erotic", [CLAUSE_C]),
    ];
    const row = summarizeFreshness(turns, ["erotic"]);
    expect(row.recycled).toBe(0);
    expect(row.fresh).toBe(row.visible);
  });

  it("見る段を絞る", () => {
    const turns = [
      buildTurn(1, "conversation", [CLAUSE_A]),
      buildTurn(2, "conversation", [CLAUSE_A]),
      buildTurn(3, "erotic", [CLAUSE_C]),
    ];
    expect(summarizeFreshness(turns, ["erotic"]).visible).toBe(
      buildTurn(3, "erotic", [CLAUSE_C]).visibleChars,
    );
  });
});
