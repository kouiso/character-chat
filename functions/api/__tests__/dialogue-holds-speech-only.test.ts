import { describe, expect, it } from "vitest";

import { CHAT_BASE_RULES } from "../../../src/lib/prompt-builder";
import { CLIMAX_LONGFORM_HINT, EROTIC_LONGFORM_HINT } from "../lib/route-context";

// 実測 2026-08-16 phase3: 台詞の中へ「（涙声で）」「（喘ぎ交じりの声）」「（くしゃくしゃの笑顔で）」
// のようなト書きが入り込んだ。前 2 アームは 0 個、この回で 30 個。ターン順に 1→2→2→4→6→9 と
// 増えとって、モデルが自分の履歴を真似て増幅しとる（<action> タグの個数が増えるのと同じ機構）。
// 一度出ると勝手には止まらんので、層の担当をプロンプトで固定する。
//
// これは禁止語の指定やない。どの層に何を書くかという形式の規則で、
// 「声色を書くな」やのうて「声色は <action> へ書け」と言うとる。

describe("台詞の層には発話だけを入れさせる", () => {
  // 段ごとの長文指示は erotic/climax にしか無い。実測では intimate と afterglow の
  // ターンにもト書きが出た（t10 の「（あなたの胸に顔を埋めながら）」は完全に地の文）。
  // 全段へ届くのは毎ターン注入される CHAT_BASE_RULES だけなので、層の定義自体に書く。
  it("全段に届く基本規則が、台詞は発話だけと定義しとる", () => {
    expect(CHAT_BASE_RULES).toContain("<dialogue> = the character's spoken words. Speech only");
    expect(CHAT_BASE_RULES).toContain("belongs in <action>");
  });

  // 実測 2026-08-16 phase4: 規則の中へ「（涙声で）」と括弧つきの実例を書いたら、
  // さくら t4 が XML タグを一つも出さず「（ト書き）」「「台詞」」の描画後の形を返した。
  // parseXmlResponse が null になり、層の構造ごと落ちた。
  // 何を書かんかを括弧つきの実物で見せると、モデルはその形を出力の見本として読む。
  it.each([
    ["基本規則", CHAT_BASE_RULES],
    ["erotic", EROTIC_LONGFORM_HINT],
    ["climax", CLIMAX_LONGFORM_HINT],
  ])("%s は括弧つきのト書きを実例として見せとらん", (_label, text) => {
    expect(text).not.toMatch(/["「]（[^）]+）["」]/);
  });

  it.each([
    ["erotic", EROTIC_LONGFORM_HINT],
    ["climax", CLIMAX_LONGFORM_HINT],
  ])("%s の長文指示が層の担当を書いとる", (_phase, hint) => {
    expect(hint).toContain("<dialogue>には口に出した言葉だけを入れ");
    expect(hint).toContain("<action>へ書く");
  });

  // 消したくなった時に、何を守っとったかが分かるようにしておく。
  it.each([
    ["erotic", EROTIC_LONGFORM_HINT],
    ["climax", CLIMAX_LONGFORM_HINT],
  ])("%s は三層の担当を全部書いとる", (_phase, hint) => {
    expect(hint).toContain("<action>で身体");
    expect(hint).toContain("<inner>で内面");
  });
});
