// @vitest-environment node
// node:sqlite は jsdom 環境ではバンドルできん。character-fixture.test.ts と同じ扱い。
import { describe, expect, it } from "vitest";

import { expectedPoliteRegister, registerExpectation } from "../../packages/judge/src/register-check";
import { buildCharacterTable } from "./character-fixture";

// register-check がどのシートを「丁寧語固定」と読むかを、実データで固定する。
// refute-r2 2026-09-14 #6 の実測: 190シート中18体が丁寧語固定と判定され、うち6体は
// 同じシートに「場面で崩れる」と書いてあった。シートが望んどる崩れを不合格にするのは
// prompt/instructions/no-injected-ai-filter.md が禁じる向きの誤りなので、
// 条件付き・崩れる前提の敬語は丁寧語固定と読まん。
const loadSheets = (): Map<string, string> => {
  const db = buildCharacterTable();
  const rows = db.prepare("SELECT id, system_prompt AS systemPrompt FROM character").all() as {
    id: string;
    systemPrompt: string;
  }[];
  db.close();
  return new Map(rows.map((row) => [row.id, row.systemPrompt]));
};

// 同じシートの中で敬語が崩れる／場面で切り替わると書いてあるキャラ。
const DRIFT_SPECIFIED_IDS: readonly string[] = [
  "char-azusa", // 九条あずさ: 仕事中は敬語、プライベートはタメ口混じり
  "char-kaori", // 篠原かおり: 普段は敬語だが二人きりだと砕ける
  "char-chihaya", // 千早: 御神酒の酔いで敬語が崩れる
  "char-yuzuki", // 柚月: 公の場では丁寧語、親密な場では変わる
  "char-shiori-boss", // 宮下詩織: 敬語ベース、崩れると「〜だよ」
  "char-saylo-ol", // 橘さよ: 普段は敬語、酔うと崩れる
  "char-reina", // 霧島レイナ: 敬語だが命令口調
  "char-rinka", // 白咲凛花: 敬語混じり、外すとタメ口
  "import-charap-ダウナーお姉さんに拾われる話", // 霜月鈴: タメ口のダウナー
  "char-shizuku", // 雨宮しずく: 控えめな口調が崩れていく過程を書く設定
  "char-shion-ohogoe", // 涼月しおん: 普段の抑制された話し方が崩れていく過程を書く設定
  "char-kirara", // 月城きらら: 配信中だけ敬語（VTuber）
  "char-aoi", // 如月あおい: 放送中だけ敬語（アナウンサー）
];

describe("expectedPoliteRegister と実シート", () => {
  const sheets = loadSheets();

  it("リポジトリ中の全シートを読める", () => {
    expect(sheets.size).toBeGreaterThan(100);
  });

  for (const id of DRIFT_SPECIFIED_IDS) {
    it(`崩れる設定のキャラは丁寧語固定と判定せん: ${id}`, () => {
      const sheet = sheets.get(id);
      expect(sheet, `シートが見つからん: ${id}`).toBeDefined();
      expect(expectedPoliteRegister(sheet)).toBe(false);
    });
  }

  // refute-r3 2026-09-14 #1 で判断を求められた点。さくらのシートは語尾に「〜です」と
  // 並べて「〜かな」「〜だよ」も挙げとる（char-koharu-ex の語尾行と speech_endings 行）。
  // 混ざるのはシートどおりなので丁寧語固定にはせん。ただし
  // doc/dogfood/l2-2026-08-18.md が核心欲求を「崩れかけて崩れきらん（丁寧語の残骸）」、
  // 失敗形を「崩れきる — 敬語消滅」と書いとるので、判定対象から外しもせん。
  it("さくらは丁寧語と常体を両方宣言しとるので polite-remnant", () => {
    expect(registerExpectation(sheets.get("char-koharu-ex"))).toBe("polite-remnant");
    expect(expectedPoliteRegister(sheets.get("char-koharu-ex"))).toBe(true);
  });

  // 「メイドの敬語を崩さないまま」と書いてあるシートは、別の行に「口調が命令形に変わる」が
  // あっても丁寧語固定（命令形も「してください♡」で敬語のまま）。
  it("崩さないと宣言しとるキャラ（天宮ひかり）は polite-fixed", () => {
    expect(registerExpectation(sheets.get("char-hikari"))).toBe("polite-fixed");
  });

  it("丁寧語固定と読むシートは全体のごく一部にとどまる", () => {
    const politeCount = [...sheets.values()].filter(expectedPoliteRegister).length;
    // 2026-09-14 実測: 190 シート中 17（丁寧語固定 7 + 残骸 10）。増える方向に動いたら、
    // 条件付き敬語をまた拾い始めとらんかを疑う。
    expect(politeCount).toBeGreaterThan(0);
    expect(politeCount).toBeLessThanOrEqual(25);
  });
});
