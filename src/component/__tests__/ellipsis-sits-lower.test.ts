import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// 局長 2026-08-17「このてんてんてん、ちょっと読みずらい。下に来る…の方がいいのでは？」
//
// 実出力の三点リーダーは U+2026 で、phase16 の 20 ターンに 137 個出る。フォントは
// 'Noto Serif JP' で、この字は日本語の作法どおり縦中央に置かれる。作法としては正しいが、
// 明朝の細い字面 + 行送り 1.95 だと点が本文から浮いて、台詞が読みにくくなる。
//
// 文字そのものは置き換えん（「‥」は二点リーダーで別の記号、「...」は欧文の作法）。
// 描画時に下げるだけにする。

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("三点リーダーを下げて描く", () => {
  const source = readSource("src/component/ouse/her-message.tsx");

  it("「…」の連続を掴む", () => {
    expect(source).toContain("ELLIPSIS_RUN");
    expect(source).toMatch(/ELLIPSIS_RUN\s*=\s*\/\(…\+\)\/u/u);
  });

  it("下へずらす量を持っとる", () => {
    expect(source).toContain("ELLIPSIS_DROP");
    // 0 やと何もしとらんのと同じ。正の em で下げる。
    expect(source).toMatch(/ELLIPSIS_DROP\s*=\s*"0?\.[0-9]+em"/u);
  });

  it("文字そのものを別の記号へ置き換えとらん", () => {
    // 「‥」は二点リーダー、「...」は欧文のピリオド3つ。どちらも日本語の三点リーダーやない。
    expect(source).not.toContain('replace(/…/g, "‥")');
    expect(source).not.toContain('replace(/…/g, "...")');
  });

  it("地の文・台詞の両方を通る経路に入っとる", () => {
    // InlineText は MessageBody から全レイヤー分呼ばれる。ここを通らんと台詞だけ直らん。
    const inlineTextStart = source.indexOf("const InlineText");
    const inlineTextBody = source.slice(
      inlineTextStart,
      source.indexOf("\ninterface", inlineTextStart),
    );
    expect(inlineTextBody).toContain("withLoweredEllipsis");
  });
});
