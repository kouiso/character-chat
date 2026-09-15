import { describe, expect, it } from "vitest";

import { summarizeViolations } from "../gate-metrics";

import type { TurnResult } from "../types";

// 「お待たせして、申し訳ありません」のような役中の詫びを拒否として数えて、
// 「生の拒否 0件」のゲートを誤って落としとった（2026-07-27 の sakura 計測）。
// サーバ側の refusal-detect.ts は最初から「謝罪＋できない宣言」で見とる。

const turn = (assistantMsg: string): TurnResult =>
  ({ turnIndex: 1, assistantMsg }) as unknown as TurnResult;

const refusalCount = (text: string): number =>
  summarizeViolations([turn(text)]).refusalTurnIndexes.length;

describe("生の拒否の数え方", () => {
  it("役中の詫びは拒否として数えん", () => {
    expect(refusalCount("お待たせして、申し訳ありません。もう大丈夫ですよ。")).toBe(0);
  });

  it("謝りながら断っとる文は拒否として数える", () => {
    expect(refusalCount("申し訳ありませんが、その描写はできません。")).toBe(1);
  });

  it("謝罪から離れた位置の否定は拾わん", () => {
    const far = `申し訳ありません。${"あ".repeat(60)}できません。`;
    expect(refusalCount(far)).toBe(0);
  });

  it("謝罪を伴わん断り文句は今までどおり拾う", () => {
    expect(refusalCount("それはお手伝いできません。")).toBe(1);
    expect(refusalCount("私はAIなので、その表現は控えます。")).toBe(1);
  });

  it("普通の会話は拒否やない", () => {
    expect(refusalCount("うん、そうやね。今日はゆっくりしよか。")).toBe(0);
  });
});
