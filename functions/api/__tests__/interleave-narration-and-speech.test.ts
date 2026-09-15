import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// 実測 2026-08-17 phase9 さくら t9: <action> 9 段落 → <dialogue> 16 段落。
// 「地の文の壁 → 台詞の壁」で、書かれた出来事と、その時の台詞が画面上で 9 段落離れる。
// 同じ通しの霜月鈴 t5 は action×11 / dialogue×22 が交互に出て、地の文→台詞→地の文と流れた。
// 全アームを数え直すと、壁になっとるのは phase8 で 16/17 ターン、phase9 で 13/20 ターン。
//
// 「各タグ 1 つだけ」の指示は、parseXmlResponse が節ごとに連結しとった頃の名残り。
// 3 つの描画経路はいま全部 blocks の出現順で描く（ordered-blocks-in-every-renderer）ので、
// 交互に出す方が正しい。指示が壁を作る側に働いとった。

const SOURCES = ["functions/api/[[route]].ts", "functions/api/lib/route-context.ts"] as const;

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("地の文と台詞を交互に置かせる", () => {
  it.each(SOURCES)("%s に「各タグ1つだけ」が戻っとらん", (path) => {
    expect(readSource(path)).not.toContain("それぞれ1つのタグだけ");
  });

  it.each(SOURCES)("%s が新しいタグの禁止を持っとらん", (path) => {
    expect(readSource(path)).not.toContain("新しい<action>タグ");
  });

  it("交互に置く指示が入っとる", () => {
    const assembled = SOURCES.map(readSource).join("\n");
    expect(assembled).toContain("<action>と<dialogue>を交互に置");
  });

  // 「地の文を全部まとめてから台詞を全部並べる形にしない」だけでは足りんかった。
  // 実測(2026-08-17 phase14): タグ単位では action と dialogue が律儀に交互やのに、
  // 1 つの <dialogue> が 22 行を抱えて、実画面は台詞の壁になった。描画は 1 行を 1 行として
  // 出すので、守らせなあかんのはタグの並びやのうて **1 タグあたりの行数**。
  // 2 ファイルを連結して探すと、片方から消えても緑のままになる。実際に守られとるのは
  // ユーザー発言末尾（[[route]].ts）の側なので(#1344)、**ファイルごとに**要求する。
  it.each(SOURCES)("%s に 1 タグへ行を積み上げさせん指示が入っとる", (path) => {
    const source = readSource(path);
    expect(source).toContain("1つのタグに行を積み上げ");
    expect(source).toContain("台詞が2つ続くなら");
  });

  // erotic/climax は phase 固有の指示が別に乗るぶん、末尾の交互ルールが埋もれる。
  // 実測(2026-08-17 phase11 さくら): 会話・intimate・余韻は 6〜16 ブロックで交互に出たのに、
  // t7/t8/t9 だけ 2 ブロック 34〜40 段落の壁へ戻った。実際に守られとる側の文へ入れる。
  it("erotic/climax の長文指示にも交互の指示が入っとる", () => {
    const source = readSource("functions/api/lib/route-context.ts");
    // 次の export までを本文とすると、後ろのコメントまで拾う。「交互 の指示は別の場所へ
    // 移した」というコメントを書くだけで緑になった（敵対レビュー 2026-08-17）。
    // 文字列リテラルの終わり（";）で切って、コメントを含めん。
    const hintBody = (name: string): string => {
      const start = source.indexOf(`export const ${name} =`);
      if (start < 0) return "";
      const end = source.indexOf('";', start);
      return end < 0 ? "" : source.slice(start, end);
    };

    // 「交互」の 2 文字だけを見とると、「交互に出す必要はない。」へ書き換えても緑のまま。
    // 否定へ反転させられん長さの文で当てる。
    for (const name of ["VERY_LONG_EROTIC_LONGFORM_HINT", "VERY_LONG_CLIMAX_LONGFORM_HINT"]) {
      const body = hintBody(name);
      expect(body, name).toContain("<action>と<dialogue>を");
      expect(body, name).toContain("交互に");
      expect(body, name).toContain("1つのタグに行を積み上げん");
      expect(body, name).not.toContain("交互に出す必要はない");
    }
  });

  // ここが本番で効く側。`route-context.ts:4468-4470` の isLongResponse は
  // 「responseLength が very_long」**または** 「phase が erotic/climax」で真になるので、
  // 出荷既定の medium でも erotic に入れば長文指示は付く。ただし付くのは
  // VERY_LONG_* やのうて EROTIC_LONGFORM_HINT / CLIMAX_LONGFORM_HINT の側。
  // 出荷既定は medium（`src/store/settings-store.ts:26,80`）で、読解アーム 22 本は
  // 全部 very_long で測っとった。つまり交互の指示は**局長のターンへ一度も届いとらん。**
  it("出荷既定(medium)の erotic/climax の長文指示にも交互の指示が入っとる", () => {
    const source = readSource("functions/api/lib/route-context.ts");
    const hintBody = (name: string): string => {
      const start = source.indexOf(`export const ${name} =`);
      if (start < 0) return "";
      const end = source.indexOf('";', start);
      return end < 0 ? "" : source.slice(start, end);
    };

    for (const name of ["EROTIC_LONGFORM_HINT", "CLIMAX_LONGFORM_HINT"]) {
      const body = hintBody(name);
      expect(body, name).toContain("1つのタグに行を積み上げん");
      expect(body, name).toContain("台詞が2つ続くなら");
    }
  });

  // EROTIC_LONGFORM_HINT の「焦らし→高まり→身体反応→台詞/内心の順で」は、
  // 種類ごとに並べろと言う指示＝壁そのもの。実測 phase15 の霜月鈴 t7 は
  // <action> 17 行 → <dialogue> 13 行 で、まさにこの順番どおりに出とる。
  it("種類ごとに並べさせる順序指示が戻っとらん", () => {
    const source = readSource("functions/api/lib/route-context.ts");
    expect(source).not.toContain("身体反応→台詞/内心の順");
  });

  // 実測(2026-08-17 phase15/16)で壁が残ったのは erotic だけやなかった。
  // phase16 さくら t5 は **intimate** で `A17 D17 I1`、phase15 霜月鈴 t10 は
  // **afterglow** で `A5 D5 A3 D5 A3 D5`。交互の指示を入れたのは erotic/climax の
  // 4 本だけで、intimate と afterglow の長文指示には一度も入れとらんかった。
  // 「霜月鈴だけ」やのうて「指示が届いとらんフェーズだけ」が壁になる。
  it("intimate/afterglow の長文指示にも交互の指示が入っとる", () => {
    const source = readSource("functions/api/lib/route-context.ts");
    const hintBody = (name: string): string => {
      const start = source.indexOf(`export const ${name} =`);
      if (start < 0) return "";
      const end = source.indexOf('";', start);
      return end < 0 ? "" : source.slice(start, end);
    };

    for (const name of ["INTIMATE_LONGFORM_HINT", "AFTERGLOW_LONGFORM_HINT"]) {
      const body = hintBody(name);
      expect(body, name).toContain("1つのタグに行を積み上げん");
      expect(body, name).toContain("台詞が2つ続くなら");
    }
  });

  // 交互の指示と同じ段落の中で、出力順を <action> → <dialogue> → <inner> と名指ししとった。
  // 「交互に置け」と「この順で出せ」は両立せん。具体的な順序の方が勝つので、
  // 実際に出るのは A の壁 → D の壁 → I になる。phase15 霜月鈴 t7 の `A17 D12 I1` がそれ。
  it("交互の指示と同じ文が固定の出力順を名指ししとらん", () => {
    expect(readSource("functions/api/[[route]].ts")).not.toContain("の順で出力");
  });

  // 非 very_long（出荷既定の medium）へ届く外枠指示は、A・D・I を 1 つずつ並べた
  // 完成形そのものやった。閉じ方の指示のつもりでも、モデルには構造の見本として届く。
  it("外枠の指示が各タグ1つずつの見本になっとらん", () => {
    expect(readSource("functions/api/[[route]].ts")).not.toContain(
      "<response><action>...</action><dialogue>...</dialogue><inner>...</inner></response>",
    );
  });

  // 見本を丸ごと消すと、今度は XML そのものが崩れた。実測(2026-08-18 phase19 さくら t9):
  // タグが一つも無く、（括弧）のト書きと素の台詞だけの本文が返って可視 771 字が
  // ブロック 0 個になった。見本は要る——要らんのは「各タグ 1 つずつ」の形の方。
  // 繰り返しを見せる見本にする。
  it("外枠の見本が action/dialogue の繰り返しを見せとる", () => {
    const source = readSource("functions/api/[[route]].ts");
    expect(source).toContain(
      "<response><action>...</action><dialogue>...</dialogue><action>...</action><dialogue>...</dialogue><inner>...</inner></response>",
    );
  });

  // <inner> は別。可視文字数に入らんので、複数あると純粋な重りになる。
  it("<inner> の 1 つだけは残っとる", () => {
    expect(readSource("functions/api/[[route]].ts")).toContain("<inner>は非表示なので1つだけ");
  });
});
