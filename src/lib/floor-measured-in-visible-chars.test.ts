import { describe, expect, it } from "vitest";

import { runQualityChecks } from "./quality-guard";

// 実測 2026-08-18 phase26 t7 の形。可視 703 字・XML タグ 422 字で生の長さは 1125 字。
// 出荷既定(medium)の erotic はフロア 960 字を強制しとるのに、タグ込みで測っとったせいで
// 合格しとった。ここはその再発を止める。
const buildReply = (blocks: number, actionChars: number, dialogueChars: number): string => {
  const parts: string[] = [];
  for (let i = 0; i < blocks; i += 1) {
    parts.push(`<action>${"あ".repeat(actionChars)}</action>`);
    parts.push(`<dialogue>${"い".repeat(dialogueChars)}</dialogue>`);
  }
  parts.push(`<inner>${"う".repeat(56)}</inner>`);
  return `<response>\n${parts.join("\n")}\n</response>`;
};

const context = {
  phase: "erotic" as const,
  longResponseMinChars: 960,
  maxResponseChars: 1200,
  skipSensualSpecificityCheck: true,
};

describe("長さフロアは画面に見える文字数で測る", () => {
  it("タグで水増しされた本文はフロア未達として落ちる", () => {
    const reply = buildReply(8, 50, 38);
    const visible = 8 * (50 + 38);
    expect(visible).toBeLessThan(960);
    // 生の長さはフロアを超えとる（＝これが素通りしとった理由）
    expect(reply.length).toBeGreaterThan(960);

    const result = runQualityChecks(reply, context);
    expect(result.passed).toBe(false);
    expect(result.failedCheck).toBe("long-response-too-short");
  });

  it("可視文字がフロアに届いとればフロアでは落ちん", () => {
    const reply = buildReply(10, 56, 44);
    expect(10 * (56 + 44)).toBeGreaterThanOrEqual(960);

    const result = runQualityChecks(reply, context);
    expect(result.failedCheck).not.toBe("long-response-too-short");
  });

  it("フロアが無い設定では長さで落ちん", () => {
    const reply = buildReply(2, 30, 20);
    const result = runQualityChecks(reply, {
      ...context,
      phase: "conversation",
      longResponseMinChars: undefined,
    });
    expect(result.failedCheck).not.toBe("long-response-too-short");
  });
});
