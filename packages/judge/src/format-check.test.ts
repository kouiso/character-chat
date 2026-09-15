import { describe, expect, it } from "vitest";

import { formatCheck } from "./format-check";

describe("formatCheck", () => {
  it("正しく閉じたタグは通る", () => {
    expect(formatCheck("<dialogue>おかえり</dialogue>")).toEqual({ ok: true });
  });

  it("閉じられてへんタグは ng", () => {
    const result = formatCheck("<action>彼女が微笑む");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/閉じられてへん/);
  });

  it("開閉タグ名が食い違うと ng", () => {
    const result = formatCheck("<action>彼女が微笑む</dialogue>");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/揃わん/);
  });

  it("許可されてへんタグは ng", () => {
    const result = formatCheck("<narration>彼女が微笑む</narration>");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/未許可タグ/);
  });

  it("コードフェンスを含むと ng", () => {
    expect(formatCheck("```\n<dialogue>test</dialogue>\n```").ok).toBe(false);
  });

  it("Markdown強調を含むと ng", () => {
    expect(formatCheck("<dialogue>**強調**</dialogue>").ok).toBe(false);
  });

  it("話者ラベルを含むと ng", () => {
    expect(formatCheck("User: こんにちは\n<dialogue>やあ</dialogue>").ok).toBe(false);
  });
});
