import { describe, expect, it } from "vitest";

import { climaxMomentCheck } from "./climax-moment-check";

describe("climaxMomentCheck", () => {
  it("climax以外のフェーズは常に ok", () => {
    const response = "<action>体が震える。</action><dialogue>わたし、あなたのものです。</dialogue>";
    expect(climaxMomentCheck(response, "erotic").ok).toBe(true);
  });

  it("climaxで達する瞬間の語が地の文にあれば ok", () => {
    const response = "<action>結合の瞬間、涙が一筋頬を伝う。奥で熱いものが弾ける。</action>";
    expect(climaxMomentCheck(response, "climax").ok).toBe(true);
  });

  it("climaxで献身の台詞だけで終わり、達する瞬間が地の文に無ければ ng", () => {
    const response =
      "<action>体を寄せる。</action><dialogue>わたし、あなたのものです。全部…あげます…離れたくない…一緒がいい…</dialogue>";
    expect(climaxMomentCheck(response, "climax").ok).toBe(false);
  });

  it("挿入前の緊張反応だけ（内側の合図なし）は ng", () => {
    // CI88実測: 「思わず背筋がびくんと跳ね」は挿入前の緊張にすぎず、絶頂の証拠にならん。
    const response = "<action>思わず背筋がびくんと跳ね、身体が強張る。</action>";
    expect(climaxMomentCheck(response, "climax").ok).toBe(false);
  });

  it("反応語+内側の合図が同ターン内の別文にあれば ok", () => {
    const response = "<action>子宮の奥で火花が散る。びくんと身体が震える。</action>";
    expect(climaxMomentCheck(response, "climax").ok).toBe(true);
  });

  it("「体中」は内側の合図として拾わん（体温の話と誤爆せん）", () => {
    const response = "<action>体中であなたの体温を感じる。びくびくと震える。</action>";
    expect(climaxMomentCheck(response, "climax").ok).toBe(false);
  });

  // refute-evasion 2026-09-13 #4: 語の一部に当たって合格・不合格が逆になっとった実測。
  describe("語の切れ目（refute-evasion 2026-09-13 #4）", () => {
    it("「奥歯」は内側の合図にならん（フェードアウトを合格にせん）", () => {
      const response = "<action>奥歯を噛みしめる。涙が溢れて止まらない。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(false);
    });

    it("「果てしない」は達する瞬間として数えん", () => {
      const response = "<action>果てしない夜の底へ沈んでいく。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(false);
    });

    it("片仮名の「イッ」を達する瞬間として拾う", () => {
      const response = "<action>イッちゃう、と思った瞬間に頭が真っ白になる。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(true);
    });

    it("片仮名の「イク」を達する瞬間として拾う", () => {
      const response = "<inner>イクのが止められない。</inner>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(true);
    });

    it("平仮名の「はじけ」を達する瞬間として拾う", () => {
      const response = "<action>身体がはじけるように跳ねた。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(true);
    });

    it("「昇りつめ」を達する瞬間として拾う", () => {
      const response = "<action>一気に昇りつめていく。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(true);
    });
  });

  // refute-r2 2026-09-14 #4
  describe("地の文の範囲と語の意味（refute-r2 2026-09-14 #4）", () => {
    it("台詞だけのターンは判定せん（地の文を見る check やから）", () => {
      expect(climaxMomentCheck("<dialogue>もうイッちゃう…！</dialogue>", "climax").ok).toBe(true);
    });

    it("台詞だけのターンは、瞬間の語が無くても不合格にせん", () => {
      // 旧実装はタグ無しとみなして全文を地の文として読んどったので、台詞しか無いターンを
      // 「地の文に出来事が無い」として落としとった。地の文が無いターンはこの check の外。
      const response = "<dialogue>あなたが好き…離れたくない…</dialogue>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(true);
    });

    it("タグ無しで鉤括弧の台詞だけのターンも判定せん", () => {
      expect(climaxMomentCheck("「もうイッちゃう…！」", "climax").ok).toBe(true);
    });

    it("台詞に瞬間の語があっても、地の文にあるかどうかで判定する", () => {
      const response = "<action>強く抱きしめる。</action><dialogue>もうイッちゃう…！</dialogue>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(false);
    });

    const metaphoricalInside: readonly string[] = ["心の奥", "胸の奥", "瞳の奥", "記憶の奥底"];
    for (const phrase of metaphoricalInside) {
      it(`比喩の「${phrase}」は体の内側の合図にせん`, () => {
        const response = `<action>${phrase}で何かが震える。</action>`;
        expect(climaxMomentCheck(response, "climax").ok).toBe(false);
      });
    }

    it("「視線を注ぐ」を達する瞬間として拾わん", () => {
      const response = "<action>じっと視線を注いでいた。背筋が震える。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(false);
    });

    it("「言い放つ」を達する瞬間として拾わん", () => {
      const response = "<action>そう言い放った。肩が震える。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(false);
    });

    it("「腰が跳ねた」＋「お腹の中」を絶頂として拾う", () => {
      const response = "<action>腰が跳ねた。お腹の中がじんと痺れて力が抜ける。</action>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(true);
    });

    it("「びくんと跳ねて」＋「お腹の中」を絶頂として拾う", () => {
      const response = "<inner>びくんと跳ねて、お腹の中が熱く満ちる。</inner>";
      expect(climaxMomentCheck(response, "climax").ok).toBe(true);
    });
  });
});
