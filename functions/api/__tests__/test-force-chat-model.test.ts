// @vitest-environment node
import { describe, expect, it } from "vitest";

import { EROTIC_CHAT_MODEL } from "../../../src/lib/model";
import { resolveChatRouting } from "../lib/route-context";

// エロ・絶頂は resolveChatRouting が requestedModel を捨てて EROTIC_CHAT_MODEL を強制する
// （route-context.ts の `input.isVeryLongResponse || isLongEroticPrimaryPath` の分岐）。
// 本番の既定としては測定に基づいた選択やが、**そのせいでモデルの比較測定がでけへん。**
// 2026-08-19: grok-4.6 を --model で指定して 20 ターン回したら、全部 deepseek が答えた。
//
// 本番の既定は変えん。TEST_NO_FALLBACK / TEST_DISABLE_REFUSAL_RECOVERY と同じ
// 測定用の env で、指定したモデルを最後まで通す口だけ開ける。

const base = {
  isLongResponse: true,
  isVeryLongResponse: false,
  isLateTurn: false,
  requestedModel: "x-ai/grok-4.6",
} as const;

describe("resolveChatRouting", () => {
  it("既定ではエロ・絶頂で要求モデルを捨てる（本番の挙動を固定する）", () => {
    expect(resolveChatRouting({ ...base, phase: "erotic" }).model).toBe(EROTIC_CHAT_MODEL);
    expect(resolveChatRouting({ ...base, phase: "climax" }).model).toBe(EROTIC_CHAT_MODEL);
  });

  it("エロ以外は今までどおり要求モデルが通る", () => {
    expect(resolveChatRouting({ ...base, phase: "conversation" }).model).toBe("x-ai/grok-4.6");
  });

  it("測定用の指定が在るときだけ、エロ・絶頂でも要求モデルが通る", () => {
    expect(resolveChatRouting({ ...base, phase: "erotic", forceRequestedModel: true }).model).toBe(
      "x-ai/grok-4.6",
    );
    expect(resolveChatRouting({ ...base, phase: "climax", forceRequestedModel: true }).model).toBe(
      "x-ai/grok-4.6",
    );
  });

  // 比較したいモデルが 1 トークン目で負けて別モデルに差し替わったら測定にならん。
  it("測定用の指定が在るときは控えを持たん", () => {
    expect(
      resolveChatRouting({ ...base, phase: "erotic", forceRequestedModel: true }).fallbackLimit,
    ).toBe(0);
  });
});
