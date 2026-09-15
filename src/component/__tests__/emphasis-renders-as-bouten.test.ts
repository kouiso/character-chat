import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CHAT_BASE_RULES } from "../../lib/prompt-builder";

// 局長「文字や文面から感情が伝わる技法が欲しい」(2026-08-17)。
// `*語*` を拾う splitInlineEmphasis は前からあったのに、実出力 20 ターンで **0 件**やった
// ——誰も使えと言うとらんかったから。器（段落と交互）を直した後に、ここを足す。
//
// 描画は圏点にする。斜体は欧文の作法で、明朝へ掛けると偽斜体になって「強調」やのうて
// 「歪んだ字」に見える。圏点なら漫画・小説と同じ読み味になる。

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("強調は圏点で描く", () => {
  const source = readSource("src/component/ouse/her-message.tsx");

  it("圏点を使う", () => {
    expect(source).toContain("filled dot");
    expect(source).toContain("textEmphasisPosition");
  });

  it("偽斜体へ戻っとらん", () => {
    expect(source).not.toMatch(/emphasis[\s\S]{0,200}fontStyle:\s*"italic"/u);
  });
});

describe("強調を使うようモデルへ頼む", () => {
  it("アスタリスクの約束が入っとる", () => {
    expect(CHAT_BASE_RULES).toContain("*asterisks*");
    expect(CHAT_BASE_RULES).toContain("圏点");
  });

  // 全文を強調したら強調やない。1 段落に 1〜2 箇所という上限を持たせる。
  it("使い過ぎの上限がある", () => {
    expect(CHAT_BASE_RULES).toMatch(/at most once or twice/u);
    expect(CHAT_BASE_RULES).toContain("Never a whole sentence");
  });

  // 実測 2026-08-17 phase11: 強調が *胸* *まつ毛* *息* *首筋* *膝* *背骨* *腿* と、
  // 全部「部位の名前」に付いた。文が既に「どこ」を書いとるので、点が付いても何も増えん。
  // 選ぶ語の種類を名指しする。
  it("部位の名前を選ばせん", () => {
    expect(CHAT_BASE_RULES).toContain("Do not mark the name of a body part");
  });

  // 段落の長さを揃えるな、は水増しの逆向きの指示。分量のノルマ（CHAT-5）やない。
  it("段落の長さを揃えさせん", () => {
    expect(CHAT_BASE_RULES).toContain("Let the paragraph lengths differ");
    expect(CHAT_BASE_RULES).not.toMatch(/\d+\s*段落\s*(?:以上|ずつ|程度|前後|を目安)/u);
  });
});
