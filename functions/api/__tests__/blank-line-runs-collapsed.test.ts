import { describe, expect, it } from "vitest";

import { sanitizeTrailingProse } from "../lib/route-context";

// 局長の本番の実利用（2026-08-18 桜庭さくら）で、<action> の末尾に空行が 8 つ並んで
// 吹き出しの真ん中が大きく途切れとった。段落の切れ目は空行 1 つで足りる。
const wrap = (inner: string) =>
  ({
    ok: true,
    text: `<response><action>${inner}</action><dialogue>「あ」</dialogue></response>`,
    chunks: [],
    usedModel: "m",
  }) as never;

const textOf = (result: { text: string }) => result.text;

describe("空行の連続を畳む", () => {
  it("3 つ以上並んだ空行は 1 つにする", () => {
    const out = textOf(sanitizeTrailingProse(wrap("前の段落\n\n\n\n\n\n\n\n\n後の段落")));
    expect(out).toContain("前の段落\n\n後の段落");
    expect(out).not.toMatch(/\n{3,}/u);
  });

  it("段落の切れ目（空行 1 つ）は残す", () => {
    const out = textOf(sanitizeTrailingProse(wrap("前の段落\n\n後の段落")));
    expect(out).toContain("前の段落\n\n後の段落");
  });

  it("空行が無ければ触らん", () => {
    const original = wrap("一続きの地の文");
    expect(textOf(sanitizeTrailingProse(original))).toBe(
      (original as unknown as { text: string }).text,
    );
  });
});
