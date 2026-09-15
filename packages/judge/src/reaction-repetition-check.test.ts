import { describe, expect, it } from "vitest";

import { reactionRepetitionCheck } from "./reaction-repetition-check";

describe("reactionRepetitionCheck", () => {
  it("同一部位×同一反応クラスの言い換えが3回続くと ng", () => {
    const response =
      "<action>腿の付け根がじんわりと湿ってくる。腿の内側を熱い潤みがゆっくり広がる。腿の付け根がとろとろに濡れていく。</action>";
    const result = reactionRepetitionCheck(response);
    expect(result.ok).toBe(false);
    expect(result.repeatedKey).toBe("腿::濡れる系");
  });

  it("2回までなら通る", () => {
    const response =
      "<action>腿の付け根がじんわりと湿ってくる。腿の内側を熱い潤みがゆっくり広がる。</action>";
    expect(reactionRepetitionCheck(response).ok).toBe(true);
  });

  it("部位語が段落ごとに違っても体液の名詞+流出動詞が揃えば同じ言い換えとみなす", () => {
    const response =
      "<action>溢れた白濁が腿の内側を伝い、染みを作る。奥で混ざり合った熱いものがまた溢れ出す。溢れた液体が腿の付け根まで伝い濡れる。</action>";
    const result = reactionRepetitionCheck(response);
    expect(result.ok).toBe(false);
    expect(result.repeatedKey).toBe("体液::流れ系");
  });

  it("<dialogue>の言い回しは対象外", () => {
    const response =
      "<dialogue>腿が濡れてる。腿がもっと濡れる。腿がずっと濡れたまま。</dialogue><action>体が震える。</action>";
    expect(reactionRepetitionCheck(response).ok).toBe(true);
  });

  it("家具の「腰掛け」は身体部位として拾わん", () => {
    const response =
      "<action>腰掛けから少し体を浮かせた瞬間、体が熱くなる。腰掛けの縁に手をついて、また熱がこもる。腰掛けを軋ませながら、さらに熱を帯びる。</action>";
    expect(reactionRepetitionCheck(response).ok).toBe(true);
  });

  // refute-evasion 2026-09-13 #5 の実測。
  it("読点で繋いだ言い換えも3回で ng", () => {
    const response =
      "<action>腿の付け根がじんわりと湿ってくる、腿の内側を熱い潤みがゆっくり広がる、腿の付け根がとろとろに濡れていく。</action>";
    const result = reactionRepetitionCheck(response);
    expect(result.ok).toBe(false);
    expect(result.repeatedKey).toBe("腿::濡れる系");
  });

  it("部位と反応が読点を跨いどっても組として数える", () => {
    const response =
      "<action>腿の付け根が、じんわりと湿ってくる。腿の内側を、熱い潤みがゆっくり広がる。腿の付け根が、とろとろに濡れていく。</action>";
    expect(reactionRepetitionCheck(response).ok).toBe(false);
  });

  it("1つの描写を読点で割っただけでは回数を水増しせん", () => {
    const response =
      "<action>溢れた白濁が腿の内側を伝い、染みを作る。奥で混ざり合った熱いものが、また滲んでいく。</action>";
    expect(reactionRepetitionCheck(response).ok).toBe(true);
  });

  // refute-r2 2026-09-14 #5: 同じ場所を呼び替えると別カウンタへ散って素通りしとった。
  describe("呼び替え・短文・タグ無し（refute-r2 2026-09-14 #5）", () => {
    it("同じ場所の言い換え（内腿／太もも／腿）を1つの部位として数える", () => {
      const response =
        "<action>内腿がじんわりと湿ってくる。太ももを熱い潤みが広がる。腿の付け根がとろとろに濡れていく。</action>";
      const result = reactionRepetitionCheck(response);
      expect(result.ok).toBe(false);
      expect(result.repeatedKey).toBe("腿::濡れる系");
    });

    it("同じ場所の言い換え（胸／乳房／胸元）を1つの部位として数える", () => {
      const response =
        "<action>胸が震える。乳房がびくんと跳ねる。胸元がふるえて止まらない。</action>";
      const result = reactionRepetitionCheck(response);
      expect(result.ok).toBe(false);
      expect(result.repeatedKey).toBe("胸::震える系");
    });

    // refute-r3 2026-09-14 #3 の実測（phase39#9 Sakura）: 絶頂の場面で体の内側を
    // 呼び替えながら4回書いても、部位ごとに散って閾値に届かんかった。
    it("体の内側の呼び替え（子宮口／膣の襞／お腹の奥／子宮の奥）を1つの部位として数える", () => {
      const response =
        "<action>子宮口がきゅっと締まる。膣の襞が痙攣する。お腹の奥が収縮していく。子宮の奥までキュンと締めつける。</action>";
      const result = reactionRepetitionCheck(response);
      expect(result.ok).toBe(false);
      expect(result.repeatedKey).toBe("内側::締まる系");
    });

    it("外から触れる場所（陰核）は内側へ寄せん", () => {
      const response = "<action>陰核が震える。子宮が震える。膣が震える。</action>";
      expect(reactionRepetitionCheck(response).ok).toBe(true);
    });

    it("短い文の反復も数える（腿が湿る。腿が濡れる。腿とろ。）", () => {
      const response = "<action>腿が湿る。腿が濡れる。腿とろ。</action>";
      expect(reactionRepetitionCheck(response).ok).toBe(false);
    });

    it("タグが無い応答では鉤括弧の中を台詞として外す", () => {
      const response =
        "「腿が濡れてる。」「腿がもっと濡れる。」「腿がずっと濡れたまま。」体が震える。";
      expect(reactionRepetitionCheck(response).ok).toBe(true);
    });

    it("タグが無い応答でも鉤括弧の外は地の文として数える", () => {
      const response = "腿が湿ってくる。腿を熱い潤みが広がる。腿がとろとろに濡れていく。";
      expect(reactionRepetitionCheck(response).ok).toBe(false);
    });
  });

  const genericParts: readonly string[] = ["指先", "膝", "肩"];
  for (const part of genericParts) {
    it(`性器から離れた部位（${part}）の連投も数える`, () => {
      const response = `<action>${part}が震える。${part}がまた震えだす。${part}がずっと震えたまま。</action>`;
      const result = reactionRepetitionCheck(response);
      expect(result.ok).toBe(false);
      expect(result.repeatedKey).toBe(`${part}::震える系`);
    });
  }

  it("<inner>も対象に含む", () => {
    const response =
      "<inner>耳が熱い。耳がもっと熱くなる。</inner><action>耳がじんじん熱を持つ。</action>";
    const result = reactionRepetitionCheck(response);
    expect(result.ok).toBe(false);
    expect(result.repeatedKey).toBe("耳::熱系");
  });
});
