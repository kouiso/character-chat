import { describe, expect, it } from "vitest";

import { CHAT_BASE_RULES } from "./prompt-builder";
import { buildSayDoDirective } from "./say-do-directive";

// composer が組み立てる記法と、それを解釈するプロンプト側のルールが食い違うと、
// モデルには [SAY: "..."] が生のまま届いて画面にも漏れる（#824 の症状）。
// 両者を1本のテストで縛る。
describe("buildSayDoDirective", () => {
  it("say は発話マーカーを組み立てる", () => {
    expect(buildSayDoDirective("say", "おはよう")).toBe('[SAY: "おはよう"]');
  });

  it("do は行動マーカーを組み立てる", () => {
    expect(buildSayDoDirective("do", "手を握る")).toBe('[DO: "手を握る"]');
  });

  it("組み立てた記法をプロンプトのルールが解釈対象にしている", () => {
    const sayPrefix = buildSayDoDirective("say", "x").split(":")[0];
    const doPrefix = buildSayDoDirective("do", "x").split(":")[0];

    expect(CHAT_BASE_RULES).toContain(`${sayPrefix}:`);
    expect(CHAT_BASE_RULES).toContain(`${doPrefix}:`);
  });
});
