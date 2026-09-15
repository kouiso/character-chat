import { describe, expect, it } from "vitest";

import { extractVoice, voiceCheck } from "./voice-check";

describe("extractVoice", () => {
  it("一人称・二人称・語尾ラベルをシートから抜く", () => {
    const sheet = ["一人称: わたし", "二人称: あなた", "語尾: 〜だわ、〜のよ"].join("\n");
    expect(extractVoice(sheet)).toEqual({
      firstPerson: ["わたし"],
      secondPerson: ["あなた"],
      endings: ["〜だわ", "〜のよ"],
      tics: [],
    });
  });

  it("英語ラベル表記でも拾う", () => {
    const sheet = "first-person: 私、わたくし\naddress: 君";
    const voice = extractVoice(sheet);
    expect(voice.firstPerson).toEqual(["私", "わたくし"]);
    expect(voice.secondPerson).toEqual(["君"]);
  });

  it("語尾ラベルが無ければ「」列挙から語尾候補を拾う", () => {
    const sheet = "一人称: 俺\n口癖として「そうだな」「悪いな」とよく言う。";
    const voice = extractVoice(sheet);
    expect(voice.endings).toEqual(["そうだな", "悪いな"]);
  });

  it("見つからん項目は空配列", () => {
    const voice = extractVoice("特に設定の無いキャラ");
    expect(voice).toEqual({ firstPerson: [], secondPerson: [], endings: [], tics: [] });
  });

  it("verbal_tics / 口癖 を tics に拾う（prompt が出力契約に載せる）", () => {
    expect(extractVoice("verbal_tics: えへへ、あの…、ふふ").tics).toEqual([
      "えへへ",
      "あの…",
      "ふふ",
    ]);
    expect(extractVoice("口癖: めんどくさい、バカじゃないの").tics).toEqual([
      "めんどくさい",
      "バカじゃないの",
    ]);
  });

  it("regression: ハイフン区切りの英語ラベル（旧フォーマット）は引き続き拾う", () => {
    const voice = extractVoice("first-person: 私、わたくし");
    expect(voice.firstPerson).toEqual(["私", "わたくし"]);
  });

  // 実シートの表記ゆれ。drizzle/0065, drizzle/0068, script/seed.ts, drizzle/0014 から
  // 逐語コピー。コロン記法しか拾えんかった旧実装ではこれら全部 firstPerson が空になっとった。
  describe("実シートの表記ゆれから一人称を拾う（table-driven）", () => {
    const cases: Array<{ source: string; sheet: string; firstPerson: string[] }> = [
      {
        source: "drizzle/0065_update_sakura_downer_persona_review_fixes.sql（桜庭さくら）",
        sheet:
          "一人称「わたし」、あなたへは「あなた」。語尾は「〜です」「〜ですね」「〜かな」「〜だよ」、恥ずかしい時は「〜なの」。",
        firstPerson: ["わたし"],
      },
      {
        source: "drizzle/0065_update_sakura_downer_persona_review_fixes.sql（霜月鈴）",
        sheet:
          "内側は孤独で執着しやすく、Sな一面は「離されないための防御」。一人称「私」、あなたへは「きみ」。皮肉っぽく、二人きりでは甘い。",
        firstPerson: ["私"],
      },
      {
        source:
          "drizzle/0065_update_sakura_downer_persona_review_fixes.sql（キャラカード・アンダースコア表記）",
        sheet:
          "first_person: わたし\naddress: あなた\nspeech_endings: 〜です、〜ですね、〜かな、〜だよ、〜なの",
        firstPerson: ["わたし"],
      },
      {
        source: "drizzle/0068_sakura_ending_overuse.sql の REPLACE 後（語尾の常時発火修正込み）",
        sheet:
          "一人称「わたし」、あなたへは「あなた」。語尾は「〜です」「〜ですね」「〜かな」「〜だよ」。「〜なの」はごく稀に、一番こらえきれんかった一言にだけ使う。",
        firstPerson: ["わたし"],
      },
      {
        source: "script/seed.ts:59（月島みつき）",
        sheet: "一人称は「あたし」、語尾は「〜でしょ？」「〜じゃない？」が多い。",
        firstPerson: ["あたし"],
      },
      {
        source: "script/seed.ts:3096（ヤリサー男キャラ）",
        sheet: "一人称「俺」、呼び方は「お前」「名前呼び」。",
        firstPerson: ["俺"],
      },
      {
        source: "drizzle/0014_refresh_adult_import_cards.sql:15",
        sheet: "- 一人称「私」、呼び方「指揮官」",
        firstPerson: ["私"],
      },
    ];

    it.each(cases)("$source", ({ sheet, firstPerson }) => {
      const voice = extractVoice(sheet);
      expect(voice.firstPerson).not.toEqual([]);
      expect(voice.firstPerson).toEqual(firstPerson);
    });
  });

  it("二人称も「」列挙の隣接パターンで複数値を拾う（呼び方は「お前」「名前呼び」）", () => {
    const voice = extractVoice("一人称「俺」、呼び方は「お前」「名前呼び」。");
    expect(voice.secondPerson).toEqual(["お前", "名前呼び"]);
  });
});

// ローカル D1 の char-koharu-ex（桜庭さくら）の system_prompt 末尾を逐語コピー。行区切りが
// 実改行やのうて 2 文字の "\n"（バックスラッシュ + n）で入っとる。2026-09-04 v2 arm（CI 89426095）
// の Sakura t6 が 43,204 字を「僕」視点で書いたのに voice が ok やった原因: "first_person: (.+)"
// が行末まで、つまりシートの残り全部を値として拾い、forbidden_words の「僕」まで firstPerson に
// 入ってしもとった（自分の一人称として扱われるので判定から除かれる）。
const SAKURA_SEEDED_SHEET_TAIL =
  "【キャラカード】\\nfirst_person: わたし\\naddress: あなた\\nspeech_endings: 〜です、〜ですね、〜かな、〜だよ、〜なの\\nverbal_tics: えへへ、あの…、ふふ、うん\\nforbidden_words: あんた、お前、僕、俺、あたし\\nsensory_focus: 春の風、桜の花びら、カフェの温かい光、柔らかいニットの袖、小さな花の髪飾り";

describe("extractVoice: 行区切りが文字列の \\n で入っとる実シート（char-koharu-ex）", () => {
  it("first_person の値は次の \\n で止まり、forbidden_words の語を一人称に混ぜん", () => {
    const voice = extractVoice(SAKURA_SEEDED_SHEET_TAIL);
    expect(voice.firstPerson).toEqual(["わたし"]);
    expect(voice.secondPerson).toEqual(["あなた"]);
    expect(voice.endings).toEqual(["〜です", "〜ですね", "〜かな", "〜だよ", "〜なの"]);
  });

  it("その voice で、Sakura t6 の <action> 1 文（僕 視点）は forbiddenPronoun=僕 で ng", () => {
    const voice = extractVoice(SAKURA_SEEDED_SHEET_TAIL);
    const result = voiceCheck("<action>彼女の体の熱が僕の体に伝わってくる</action>", voice);
    expect(result.ok).toBe(false);
    expect(result.forbiddenPronoun).toBe("僕");
  });
});

describe("voiceCheck", () => {
  const voice = extractVoice("一人称: わたし");

  it("シート通りの一人称なら通る", () => {
    const text = "<inner>わたしはどうしたらいいの……</inner>";
    expect(voiceCheck(text, voice)).toEqual({ ok: true });
  });

  it("シートに無い一人称（私）に置き換わっとると ng", () => {
    const text = "<inner>私はどうしたらいいの……</inner>";
    const result = voiceCheck(text, voice);
    expect(result.ok).toBe(false);
    expect(result.forbiddenPronoun).toBe("私");
  });

  it("ナレーション（action）でも一人称の置き換えを検出する", () => {
    const text = "<action>俺はゆっくりと手を伸ばした。</action>";
    const result = voiceCheck(text, voice);
    expect(result.ok).toBe(false);
    expect(result.forbiddenPronoun).toBe("俺");
  });

  it("dialogue内は判定対象外（呼び方を変えることがあるため）", () => {
    const text = "<dialogue>私、待ってたの</dialogue>";
    expect(voiceCheck(text, voice)).toEqual({ ok: true });
  });

  it("シートに一人称の指定が無いキャラは voice 判定をせん", () => {
    const noVoice = extractVoice("特に設定の無いキャラ");
    const text = "<inner>私はどうしよう</inner>";
    expect(voiceCheck(text, noVoice)).toEqual({ ok: true });
  });

  // F2: secondPerson / endings は抜いとるだけで判定に使ってへんかった。
  describe("二人称の齟齬（dialogue内）", () => {
    const voiceWithAddress = extractVoice("一人称: わたし\n二人称: あんた、きみ");

    it("シートに無い二人称（貴方）が dialogue に出とると ng", () => {
      const text = "<dialogue>貴方が好き</dialogue>";
      const result = voiceCheck(text, voiceWithAddress);
      expect(result.ok).toBe(false);
      expect(result.forbiddenAddress).toBe("貴方");
    });

    it("シート通りの二人称なら通る", () => {
      const text = "<dialogue>あんた、そこにいたの</dialogue>";
      expect(voiceCheck(text, voiceWithAddress)).toMatchObject({ ok: true });
    });

    it("シートに二人称の指定が無いキャラは二人称判定をせん", () => {
      const voiceWithoutAddress = extractVoice("一人称: わたし");
      const text = "<dialogue>貴方が好き</dialogue>";
      expect(voiceCheck(text, voiceWithoutAddress)).toMatchObject({ ok: true });
    });
  });

  describe("語尾の齟齬（warning、ok は落とさん）", () => {
    const voiceWithEndings = extractVoice("一人称: わたし\n語尾: 〜だわ、〜のよ");

    it("シートに無い語尾しか dialogue に出てへんと endingsMismatch が立つが ok は true のまま", () => {
      const text = "<dialogue>そうですね</dialogue>";
      const result = voiceCheck(text, voiceWithEndings);
      expect(result.ok).toBe(true);
      expect(result.endingsMismatch).toBe(true);
    });

    it("シート通りの語尾が使われとると endingsMismatch は立たん", () => {
      const text = "<dialogue>今日はいい天気だわ</dialogue>";
      const result = voiceCheck(text, voiceWithEndings);
      expect(result.endingsMismatch).toBeFalsy();
    });
  });
});

describe("voiceCheck: 自分の名前を三人称の主語にした語り", () => {
  const voice = { firstPerson: ["わたし"], secondPerson: [], endings: [], tics: [] };

  it("「さくらは微笑んだ」は ng（姓名「桜庭 さくら」の名の側で拾う）", () => {
    const result = voiceCheck(
      "<action>さくらは微笑んで髪飾りに触れた</action>",
      voice,
      "桜庭 さくら",
    );
    expect(result).toMatchObject({ ok: false, thirdPersonSelf: "さくらは" });
  });

  it("台詞の中で相手が名前を呼ぶのは対象外", () => {
    expect(
      voiceCheck("<dialogue>「さくらは、どう思う？」</dialogue>", voice, "桜庭 さくら"),
    ).toMatchObject({
      ok: true,
    });
  });

  it("1 字の名（鈴）は普通名詞と区別がつかんので拾わん", () => {
    expect(voiceCheck("<action>鈴の音が遠くで鳴った</action>", voice, "霜月 鈴")).toMatchObject({
      ok: true,
    });
  });

  it("名前を渡さんければ判定せん", () => {
    expect(voiceCheck("<action>さくらは微笑んだ</action>", voice)).toMatchObject({ ok: true });
  });
});
