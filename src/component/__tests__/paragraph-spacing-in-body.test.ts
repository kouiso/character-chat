import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// 実測 2026-08-17 phase9 さくら t9: <action> が 9 段落、<dialogue> が 16 段落。
// ブロック同士は 12px 空くのに、ブロック**の中**の段落は改行しか持っとらんかったので、
// 9 段落が一枚の板に見えた。局長の「読みづらいけど言語化がむずい」の実体がこれ——
// 個々の文は悪ないので、どこが悪いか指を差せん。悪いのは塊の大きさ。
//
// 描画側だけの修正なので、モデルの出力を一切変えずに今の本文へそのまま効く。

const HER_MESSAGE = "src/component/ouse/her-message.tsx";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("本文の段落は間を持つ", () => {
  it("ブロックの本文を段落へ割る", () => {
    expect(readSource(HER_MESSAGE)).toContain("splitParagraphs");
  });

  it("段落ごとに上マージンを付ける", () => {
    const source = readSource(HER_MESSAGE);
    expect(source).toMatch(/paragraphIndex\s*>\s*0\s*\?/u);
  });

  // 段落の間はブロックの間より狭い。逆転すると段落とブロックの区別が消えて、
  // 交互に置いた地の文と台詞の切れ目が読めんくなる。
  it("段落の間はブロックの間より狭い", () => {
    const source = readSource(HER_MESSAGE);
    const blockGap = /marginTop:\s*index\s*>\s*0\s*\?\s*(\d+)/u.exec(source)?.[1];
    const paragraphGap = /marginTop:\s*paragraphIndex\s*>\s*0\s*\?\s*"([\d.]+)em"/u.exec(
      source,
    )?.[1];

    expect(blockGap).toBe("12");
    // action は 13.5px なので 0.7em ≒ 9.5px、dialogue は 18px なので ≒ 12.6px。
    // どちらも段落として読める間隔で、action ではブロック間より確実に狭い。
    expect(Number(paragraphGap)).toBeLessThanOrEqual(0.75);
    expect(Number(paragraphGap)).toBeGreaterThan(0);
  });
});
