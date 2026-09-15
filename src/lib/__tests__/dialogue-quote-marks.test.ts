import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseXmlResponse } from "../xml-response-parser";

// 括弧を描画側で足すのは 2026-08-17 に一度入れて、同日に外した。記録を残す。
//
// 入れた理由: 地の文と台詞を交互のブロックへ分けた途端、鉤括弧の付いた台詞が
// phase7 100% → phase11 31% へ落ちた。括弧の無い台詞は「大きい地の文」に見える。
//
// 外した理由: <dialogue> タグは台詞の器として信用でけへん。実測（記録した 92 通し・
// dialogue 3,531 行）では、括弧の無い 547 行のうち **67% が地の文**やった。モデルは
// 地の文を <dialogue> へ入れる方向にも同じだけ雑で、括弧を足すとその地の文を
// 「これは台詞や」と言い切ってしまう。phase14 では 4 行、phase6 では 15 行が
// 90 字超の描写文まるごと括られた:
//
//   「腰を上げた拍子にスカートがずり落ち、膝の裏がじっとりと汗ばむ。…」
//
// 見た目が惜しいのと、嘘をつくのは別。器の取り違えは生成側の問題なので、
// 描画側で塗り潰さん。
//
// 戻すなら、タグの種類やのうて中身から台詞と地の文を見分けられる根拠が要る。
// 長さでは分かれん（55〜67 字の帯に台詞と地の文が両方おる）ことは測ってある。

const RENDERER = "src/component/ouse/her-message.tsx";
const PARSER = "src/lib/xml-response-parser.ts";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("括弧を描画側で足さん", () => {
  it.each([RENDERER, PARSER])("%s に formatDialogueLine が戻っとらん", (path) => {
    expect(readSource(path)).not.toContain("formatDialogueLine");
  });

  it("<dialogue> の中身をそのまま渡す", () => {
    const parsed = parseXmlResponse(
      "<action>指が止まる。</action><dialogue>あの…いいえ、全然気にしてません。</dialogue><inner>どうしよう。</inner>",
    );
    const dialogue = parsed?.blocks?.find((block) => block.type === "dialogue");
    expect(dialogue?.text).toBe("あの…いいえ、全然気にしてません。");
  });

  it("モデルが付けた括弧も足さず引かず渡す", () => {
    const parsed = parseXmlResponse(
      "<action>指が止まる。</action><dialogue>「……逃がさないって、言ったでしょ」</dialogue><inner>どうしよう。</inner>",
    );
    const dialogue = parsed?.blocks?.find((block) => block.type === "dialogue");
    expect(dialogue?.text).toBe("「……逃がさないって、言ったでしょ」");
  });
});
