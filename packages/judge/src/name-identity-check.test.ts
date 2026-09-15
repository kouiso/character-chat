import { describe, expect, it } from "vitest";

import { nameIdentityCheck } from "./name-identity-check";

// 他キャラの名前。呼び手（bench / 生成側）が「これは名前や」と知っとる語を渡す想定。
const KNOWN = { knownNames: ["つかさ"] } as const;

describe("nameIdentityCheck", () => {
  it("既知の名前を敬称付きで呼ばれたら誤った呼び名として検出する", () => {
    const result = nameIdentityCheck("つかさちゃん、今日は疲れた？", "さくら", KNOWN);
    expect(result.shouldRemind).toBe(true);
    expect(result.wrongName).toBe("つかさ");
  });

  it("呼び捨て＋感嘆符も検出する（つかさ！）", () => {
    const result = nameIdentityCheck("つかさ！ こっち向いて", "さくら", KNOWN);
    expect(result.shouldRemind).toBe(true);
    expect(result.wrongName).toBe("つかさ");
  });

  it("呼びかけ語のあとの呼び捨て＋感嘆符も検出する（ねえ、つかさ！）", () => {
    const result = nameIdentityCheck("ねえ、つかさ！", "さくら", KNOWN);
    expect(result.shouldRemind).toBe(true);
    expect(result.wrongName).toBe("つかさ");
  });

  // 片仮名の敬称は正規化で平仮名へ畳む（refute-r2 2026-09-14 #3）。
  const katakanaHonorifics: readonly string[] = ["クン", "サン", "チャン"];
  for (const honorific of katakanaHonorifics) {
    it(`片仮名の敬称（${honorific}）でも検出する`, () => {
      // 既知の名前やのうて「1文字違い」の側で拾わせて、敬称の正規化だけを見る。
      const result = nameIdentityCheck(`さこら${honorific}、元気？`, "さくら");
      expect(result.shouldRemind).toBe(true);
      expect(result.wrongName).toBe("さこら");
    });
  }

  it("キャラ名の1文字違い（呼び間違い）は検出する", () => {
    const result = nameIdentityCheck("さこらちゃん、おはよう", "さくら");
    expect(result.shouldRemind).toBe(true);
    expect(result.wrongName).toBe("さこら");
  });

  it("キャラ名を縮めた愛称は呼び間違いにせん（さくちゃん）", () => {
    // キャラ名の一部だけで呼ぶのは普通の呼び方で、訂正する相手やない。
    expect(nameIdentityCheck("さくちゃん、おはよう", "さくら").shouldRemind).toBe(false);
  });

  it("既知の名前にもキャラ名にも似とらん語は、敬称が付いとっても黙る", () => {
    // 代償として受け入れた見逃し。誤爆（不要な訂正テンプレ）より軽い方を取る。
    expect(nameIdentityCheck("ゆかりちゃん、元気？", "さくら").shouldRemind).toBe(false);
  });

  it("既知の名前として渡された語は敬称も感嘆符も無くても検出する", () => {
    const result = nameIdentityCheck("ねえ、つかさ？", "さくら", { knownNames: ["つかさ"] });
    expect(result.shouldRemind).toBe(true);
    expect(result.wrongName).toBe("つかさ");
  });

  it("正しいキャラ名を敬称付きで呼んでも誤爆せん", () => {
    expect(nameIdentityCheck("さくらちゃん、今日は元気？", "さくら").shouldRemind).toBe(false);
  });

  it("キャラ名の別表記（読み）でも誤爆せん", () => {
    const result = nameIdentityCheck("サクラちゃん、おはよう", "桜庭さくら", {
      characterAliases: ["サクラ"],
    });
    expect(result.shouldRemind).toBe(false);
  });

  it("登録済みユーザー名で自称しても誤爆せん", () => {
    expect(
      nameIdentityCheck("つかさだけど、そっちは元気？", "さくら", { userName: "つかさ" })
        .shouldRemind,
    ).toBe(false);
  });

  it("親族・役割の呼称は名前として拾わん（お母さん）", () => {
    expect(nameIdentityCheck("お母さん、まだ起きてる？", "さくら").shouldRemind).toBe(false);
  });

  it("句の途中の敬称は名前として拾わん（今日はつかさちゃんと会った）", () => {
    expect(nameIdentityCheck("今日はつかさちゃんと会った", "さくら").shouldRemind).toBe(false);
  });

  it("呼びかけ語そのもの（ねえ）を名前として拾わん", () => {
    expect(nameIdentityCheck("ねえ！ 聞いてる？", "さくら").shouldRemind).toBe(false);
  });

  it("名前として呼ぶ形が無ければ判定せん（誤爆より見逃しを取る）", () => {
    // 呼び捨てのみ（つかさ、…）は敬称も感嘆符も無いので拾わん。旧実装はここを拾おうとして
    // 日本語の大半の語を名前候補にしてしもうた。
    expect(nameIdentityCheck("つかさ、今日は疲れた？", "さくら").shouldRemind).toBe(false);
  });

  // refute-r2 2026-09-14 #3: 敬称が付いただけで役割名・決まり文句が呼び名として通っとった。
  describe("役割名・決まり文句（refute-r2 2026-09-14 #3）", () => {
    const falseFireInputs: readonly string[] = [
      "おっちゃん、ありがとう",
      "わんちゃん、かわいいね",
      "看護師さん、ここが痛い",
      "店長さん、注文いいですか",
      "お疲れさま",
      "お疲れさま！",
      "ごちそうさま",
      "ごちそうさまでした",
      "おまわりさん、道を教えて",
      "お兄さん、ちょっといい？",
      "運転手さん、そこで止めて",
      "神さま、お願い",
    ];

    for (const input of falseFireInputs) {
      it(`「${input}」は呼び名として拾わん`, () => {
        expect(nameIdentityCheck(input, "さくら", KNOWN).shouldRemind).toBe(false);
      });
    }
  });

  it("空の発言は判定せん", () => {
    expect(nameIdentityCheck("", "さくら").shouldRemind).toBe(false);
  });

  it("キャラ名が空なら判定せん", () => {
    expect(nameIdentityCheck("つかさちゃん、元気？", "").shouldRemind).toBe(false);
  });

  // refute-evasion 2026-09-13 #3 が実測で誤爆させた入力。全て名前やない。
  describe("誤爆入力（refute-evasion 2026-09-13 #3）", () => {
    const falseFireInputs: readonly string[] = [
      "もういい、やめて",
      "もういい！",
      "そろそろ、いこ",
      "そろそろ！",
      "きもちいい！",
      "はぁ、はぁ……",
      "はぁ！",
      "うれしい！",
      "ちからつよくして",
      "すきだよ！",
      "そのまま、上から",
      "……その距離、わざと？",
      "ね、聞いてる？",
      "もっと！",
      "やめて！",
      "奥まで！",
    ];

    for (const input of falseFireInputs) {
      it(`「${input}」は呼び名として拾わん`, () => {
        expect(nameIdentityCheck(input, "鈴").shouldRemind).toBe(false);
      });
    }
  });
});
