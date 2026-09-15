import { describe, expect, it } from "vitest";

import { stemRepetitionCheck } from "./stem-repetition-check";

describe("stemRepetitionCheck", () => {
  it("感覚語の語幹が5回出ると ng（部位が毎回違っても）", () => {
    const text =
      "<action>子宮の奥が熱い。お腹の奥も熱く火照る。</action><dialogue>熱くてたまらない。もっと熱くして、熱を感じたい。</dialogue>";
    const result = stemRepetitionCheck(text);
    expect(result.ok).toBe(false);
    expect(result.category).toBe("sensation");
  });

  it("感覚語の語幹が4回までなら通る", () => {
    const text = "<action>熱い。もっと熱く。熱を感じる。熱いまま。</action>";
    expect(stemRepetitionCheck(text).ok).toBe(true);
  });

  it("小道具語（汗）は閾値4で ng", () => {
    const text =
      "<action>額に浮かんだ汗。髪の毛が汗で張り付く。背中がすっと汗ばんでいる。自分の汗とあなたの体温が混ざる。</action>";
    const result = stemRepetitionCheck(text);
    expect(result.ok).toBe(false);
    expect(result.category).toBe("prop");
  });

  it("小道具語は感覚語より狭い閾値（3回までは通る）", () => {
    const text = "<action>汗が浮かぶ。汗が伝う。汗ばむ肌。</action>";
    expect(stemRepetitionCheck(text).ok).toBe(true);
  });

  it("無関係な語は落とさん", () => {
    const text = "<action>穏やかな午後、二人でお茶を飲む。</action>";
    expect(stemRepetitionCheck(text).ok).toBe(true);
  });

  // refute-evasion 2026-09-13 #2: 仮名で書き直すとカウンタがリセットされて素通りしとった。
  it("漢字と仮名を混ぜて書いても同じ語幹として数える（熱い/あつい）", () => {
    const text =
      "<action>子宮の奥が熱い。お腹の奥もあつく火照る。</action><dialogue>あつくてたまらない。もっとあつくして、熱を感じたい。</dialogue>";
    const result = stemRepetitionCheck(text);
    expect(result.ok).toBe(false);
    expect(result.category).toBe("sensation");
    expect(result.stem).toBe("熱");
  });

  it("片仮名書きも同じ語幹として数える（ヌレ/濡れ）", () => {
    const text =
      "<action>濡れた指先。もっとヌレた音がする。ぬれたシーツ。</action><dialogue>濡れちゃう。ヌレてるのが分かる。</dialogue>";
    const result = stemRepetitionCheck(text);
    expect(result.ok).toBe(false);
    expect(result.stem).toBe("濡れ");
  });

  it("蕩け・溶け・とろけ は1つの語幹として合流させる", () => {
    const text =
      "<action>蕩けた顔。溶けていく意識。とろけた声。</action><dialogue>蕩けちゃう。溶けそう。</dialogue>";
    const result = stemRepetitionCheck(text);
    expect(result.ok).toBe(false);
    expect(result.stem).toBe("とろけ");
  });

  it("小道具語も仮名書きで数える（汗/あせ）", () => {
    const text =
      "<action>額に浮かんだ汗。髪の毛があせで張り付く。背中がすっとあせばんでいる。自分の汗とあなたの体温が混ざる。</action>";
    const result = stemRepetitionCheck(text);
    expect(result.ok).toBe(false);
    expect(result.category).toBe("prop");
    expect(result.stem).toBe("汗");
  });

  it("「焦る」を汗として数えん", () => {
    const text = "<action>あせる。あせらないで。あせりが出る。あせるな。</action>";
    expect(stemRepetitionCheck(text).ok).toBe(true);
  });

  it("「しまう」を締まる系として数えん", () => {
    const text =
      "<action>言ってしまう。忘れてしまった。閉じてしまう。泣いてしまいそう。零してしまう。</action>";
    expect(stemRepetitionCheck(text).ok).toBe(true);
  });

  it("「うずくまる」を疼きとして数えん", () => {
    const text =
      "<action>うずくまる。またうずくまった。うずくまったまま。うずくまる背中。うずくまる影。</action>";
    expect(stemRepetitionCheck(text).ok).toBe(true);
  });

  // refute-r2 2026-09-14 #2: 熟語の「熱」と「焦って」を感覚語として数えとった。
  describe("誤検出（refute-r2 2026-09-14 #2）", () => {
    const compoundHeatWords: readonly string[] = ["情熱", "熱心", "加熱", "熱中", "熱狂"];
    for (const word of compoundHeatWords) {
      it(`熟語の「${word}」を感覚語として数えん`, () => {
        const text = `<action>${word}。${word}。${word}。${word}。${word}。</action>`;
        expect(stemRepetitionCheck(text).ok).toBe(true);
      });
    }

    it("熟語が混ざっても、感覚の「熱」だけを数える", () => {
      const text =
        "<action>情熱的に見つめる。熱心に話す。加熱した鍋。熱い。熱く火照る。</action><dialogue>熱がこもる。</dialogue>";
      expect(stemRepetitionCheck(text).ok).toBe(true);
    });

    it("「焦って」を汗として数えん", () => {
      const text =
        "<action>あせって振り向く。あせってしまう。あせっている。あせってばかり。</action>";
      expect(stemRepetitionCheck(text).ok).toBe(true);
    });

    // refute-r3 2026-09-14 #2: 記号を消すと隣の漢字とくっついて、元は無かった熟語に見えとった。
    const separated: readonly string[] = ["手、熱い", "手…熱い", "手 熱い", "指・熱い"];
    for (const phrase of separated) {
      it(`記号で隔てた「${phrase}」の熱は熟語やない`, () => {
        const text = `<action>${phrase}。${phrase}。${phrase}。${phrase}。${phrase}。</action>`;
        const result = stemRepetitionCheck(text);
        expect(result.ok).toBe(false);
        expect(result.stem).toBe("熱");
      });
    }

    it("「熱気」は読みを当てずに熟語として扱う", () => {
      const text = "<action>熱気。熱気がこもる。熱気の中。熱気。熱気。</action>";
      expect(stemRepetitionCheck(text).ok).toBe(true);
    });

    it("見えん文字を挟んでも同じ語幹として数える", () => {
      const text = "<action>熱​い。熱‌く火照る。熱⁠を感じる。あつ​い。あつ︀くなる。</action>";
      const result = stemRepetitionCheck(text);
      expect(result.ok).toBe(false);
      expect(result.stem).toBe("熱");
    });
  });
});
