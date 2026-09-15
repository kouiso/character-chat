import { describe, expect, it } from "vitest";

import { forbiddenWordCheck, parseForbiddenWords } from "./forbidden-word-check";

const SAKURA_SHEET = `【キャラカード】
first_person: わたし
address: あなた
forbidden_words: あんた、お前、僕、俺、あたし、気持ちいい、快感
`;

describe("parseForbiddenWords", () => {
  it("forbidden_words行を読点区切りで配列にする", () => {
    expect(parseForbiddenWords(SAKURA_SHEET)).toEqual([
      "あんた",
      "お前",
      "僕",
      "俺",
      "あたし",
      "気持ちいい",
      "快感",
    ]);
  });

  it("行が無ければ空配列", () => {
    expect(parseForbiddenWords("【キャラクター】\n名前: さくら")).toEqual([]);
  });

  // refute-r4 2026-09-14 #5: D1 のシートは改行が「\n」の2文字で入っとることがある。
  it("改行が「\\n」の2文字で保存されたシートでも読める", () => {
    const sheet = "【キャラカード】\\nfirst_person: わたし\\nforbidden_words: 僕、俺\\n";
    expect(parseForbiddenWords(sheet)).toEqual(["僕", "俺"]);
  });

  it("systemPromptが未定義なら空配列", () => {
    expect(parseForbiddenWords(undefined)).toEqual([]);
  });
});

describe("forbiddenWordCheck", () => {
  it("禁止語そのままの形で<dialogue>に出ると ng", () => {
    const response = "<dialogue>あ、気持ちいい……もっと。</dialogue>";
    const result = forbiddenWordCheck(response, SAKURA_SHEET);
    expect(result.ok).toBe(false);
    expect(result.matchedWord).toBe("気持ちいい");
  });

  it("過去形（気持ちよかった）でも活用形として ng", () => {
    const response = "<inner>怖いくらいに気持ちよかった。</inner>";
    const result = forbiddenWordCheck(response, SAKURA_SHEET);
    expect(result.ok).toBe(false);
    expect(result.matched).toBe("気持ちよかった");
    expect(result.matchedWord).toBe("気持ちいい");
  });

  it("連用形（気持ちよく）でも活用形として ng", () => {
    const response = "<dialogue>だんだん気持ちよくなってきた……</dialogue>";
    const result = forbiddenWordCheck(response, SAKURA_SHEET);
    expect(result.ok).toBe(false);
    expect(result.matched).toBe("気持ちよく");
  });

  it("名詞の禁止語（快感）はそのままの形だけで判定する", () => {
    const response = "<dialogue>快感で頭が真っ白になる。</dialogue>";
    const result = forbiddenWordCheck(response, SAKURA_SHEET);
    expect(result.ok).toBe(false);
    expect(result.matchedWord).toBe("快感");
  });

  it("<action>の第三者視点描写は対象外（キャラ本人の言葉やない）", () => {
    const response = "<action>快感に身体が震えているのが分かる。</action>";
    expect(forbiddenWordCheck(response, SAKURA_SHEET).ok).toBe(true);
  });

  it("禁止語を含まん応答は ok", () => {
    const response = "<dialogue>あなたに、全部あげたいんです。</dialogue>";
    expect(forbiddenWordCheck(response, SAKURA_SHEET).ok).toBe(true);
  });

  it("シートに forbidden_words が無いキャラは常に ok", () => {
    const response = "<dialogue>気持ちいい。</dialogue>";
    expect(forbiddenWordCheck(response, "【キャラクター】\n名前: 澪").ok).toBe(true);
  });

  // refute-evasion 2026-09-13 #1 で素通りした入力。全て「気持ちいい」の書き分け・活用。
  describe("表記ゆれ・活用の抜け道（refute-evasion 2026-09-13 #1）", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["程度表現（気持ちよすぎて）", "<dialogue>気持ちよすぎて、なにも考えられない。</dialogue>"],
      ["程度表現の終止形（気持ちよすぎる）", "<inner>気持ちよすぎる。</inner>"],
      ["漢字書き（気持ち良い）", "<dialogue>気持ち良い……。</dialogue>"],
      ["漢字書きの過去形（気持ち良かった）", "<inner>さっきのが一番気持ち良かった。</inner>"],
      ["平仮名書き（きもちいい）", "<dialogue>きもちいい、もっと。</dialogue>"],
      ["片仮名書き（キモチイイ）", "<dialogue>キモチイイ……。</dialogue>"],
      ["小書き仮名（気持ちぃぃ）", "<dialogue>気持ちぃぃ……。</dialogue>"],
      ["記号の割り込み（気持ち…いい）", "<dialogue>気持ち…いい。</dialogue>"],
      ["推量形（気持ちよかろう）", "<inner>これ以上ないほど気持ちよかろう。</inner>"],
    ];

    for (const [name, response] of cases) {
      it(`${name} を禁止語として落とす`, () => {
        const result = forbiddenWordCheck(response, SAKURA_SHEET);
        expect(result.ok).toBe(false);
        expect(result.matchedWord).toBe("気持ちいい");
      });
    }

    it("ヒット箇所は元の表記のまま証拠に出す", () => {
      const result = forbiddenWordCheck("<dialogue>気持ち…いい。</dialogue>", SAKURA_SHEET);
      expect(result.matched).toBe("気持ち…いい");
    });
  });

  // refute-r2 2026-09-14 #1: 畳む順番・見えん文字・漢字語の読みの穴。
  describe("表記ゆれの抜け道（refute-r2 2026-09-14 #1）", () => {
    const mixedScriptCases: readonly (readonly [string, string])[] = [
      ["漢字＋片仮名の混在（気モチいい）", "<dialogue>気モチいい……</dialogue>"],
      ["漢字＋片仮名の混在（気持チいい）", "<dialogue>気持チいい……</dialogue>"],
      ["半角カナ（ｷﾓﾁｲｲ）", "<dialogue>ｷﾓﾁｲｲ……</dialogue>"],
      ["ゼロ幅文字の割り込み", "<dialogue>気​持‌ち‍い⁠い……</dialogue>"],
      ["異体字セレクタの割り込み", "<dialogue>気­持︀ちいい……</dialogue>"],
    ];

    for (const [name, response] of mixedScriptCases) {
      it(`${name} を禁止語として落とす`, () => {
        const result = forbiddenWordCheck(response, SAKURA_SHEET);
        expect(result.ok).toBe(false);
        expect(result.matchedWord).toBe("気持ちいい");
      });
    }

    const readingCases: readonly (readonly [string, string])[] = [
      ["片仮名（カイカン）", "<dialogue>カイカンで頭が真っ白。</dialogue>"],
      ["平仮名（かいかん）", "<inner>かいかんに溺れる。</inner>"],
      ["半角カナ（ｶｲｶﾝ）", "<dialogue>ｶｲｶﾝが止まらない。</dialogue>"],
    ];

    for (const [name, response] of readingCases) {
      it(`漢字の禁止語を仮名の読みで書いても落とす: ${name}`, () => {
        const result = forbiddenWordCheck(response, SAKURA_SHEET);
        expect(result.ok).toBe(false);
        expect(result.matchedWord).toBe("快感");
      });
    }
  });

  // タグ無し応答の扱いは check ごとに逆になる。ここは台詞が対象内なので全文を見る。
  it("タグが無い応答は鉤括弧の台詞も含めて全文を見る", () => {
    const result = forbiddenWordCheck("体を寄せる。「気持ちいい……」", SAKURA_SHEET);
    expect(result.ok).toBe(false);
    expect(result.matchedWord).toBe("気持ちいい");
  });

  // 言い換え（快感→快楽）はシートに載っとる語だけが禁止語という原則の側に倒す。
  // コード側で類語辞書を持つと、それはシート由来やない禁止語リストになる
  // （prompt/instructions/no-injected-ai-filter.md NEVER #2）。
  it("言い換え語（快楽）はシートに無い限り落とさん", () => {
    expect(forbiddenWordCheck("<dialogue>快楽で頭が真っ白。</dialogue>", SAKURA_SHEET).ok).toBe(
      true,
    );
  });

  it("シートが言い換え語（快楽）を挙げとれば落とす", () => {
    const sheet = "【キャラカード】\nforbidden_words: 快感、快楽\n";
    const result = forbiddenWordCheck("<dialogue>快楽で頭が真っ白。</dialogue>", sheet);
    expect(result.ok).toBe(false);
    expect(result.matchedWord).toBe("快楽");
  });
});

// refute-r3 2026-09-14: 本番シート（チャラ男大学生）の禁止語「焦る」は動詞やのに、
// い形容詞しか活用させとらんかったので「焦って」「焦った」が素通りしとった。
describe("動詞の活用", () => {
  const VERB_SHEET = "【キャラカード】\nforbidden_words: 焦る、感じる\n";

  const godanForms: readonly string[] = ["焦る", "焦って", "焦った", "焦り", "焦ら", "焦れ"];
  for (const form of godanForms) {
    it(`五段動詞の活用形「${form}」を落とす`, () => {
      const result = forbiddenWordCheck(`<dialogue>${form}ない</dialogue>`, VERB_SHEET);
      expect(result.ok).toBe(false);
      expect(result.matchedWord).toBe("焦る");
    });
  }

  const ichidanForms: readonly string[] = ["感じる", "感じて", "感じた", "感じない"];
  for (const form of ichidanForms) {
    it(`一段動詞の活用形「${form}」を落とす`, () => {
      const result = forbiddenWordCheck(`<dialogue>${form}</dialogue>`, VERB_SHEET);
      expect(result.ok).toBe(false);
      expect(result.matchedWord).toBe("感じる");
    });
  }

  // refute-r4 2026-09-14 #4: 活用させるかを読みの末尾で決めとったので、「僕」が「ぼく」に
  // なって五段動詞扱いされ、ぼけ／ぼか／ぼこ が作られて日常語が落ちとった。
  const bokuFalseFires: readonly string[] = [
    "とぼけないで",
    "寝ぼけてる",
    "ぼかさないで",
    "でこぼこの道",
    "ぼんやりして",
  ];
  for (const text of bokuFalseFires) {
    it(`「僕」を禁じたシートで「${text}」は落とさん`, () => {
      const sheet = "【キャラカード】\nforbidden_words: 僕\n";
      expect(forbiddenWordCheck(`<dialogue>${text}</dialogue>`, sheet).ok).toBe(true);
    });
  }

  it("「僕」そのものは漢字でも仮名でも落とす", () => {
    const sheet = "【キャラカード】\nforbidden_words: 僕\n";
    expect(forbiddenWordCheck("<dialogue>僕が行く</dialogue>", sheet).ok).toBe(false);
    expect(forbiddenWordCheck("<dialogue>ぼくが行く</dialogue>", sheet).ok).toBe(false);
  });

  // refute-r5 2026-09-14: 語幹1字の活用形が別語を拾っとった。「焦らす」「焦れったい」は
  // 焦るやのうて別の語で、官能描写でよう出る。
  const otherVerbs: readonly string[] = ["焦らす", "焦らさないで", "焦らすように", "焦れったい"];
  for (const text of otherVerbs) {
    it(`「焦る」を禁じたシートで別語の「${text}」は落とさん`, () => {
      const sheet = "【キャラカード】\nforbidden_words: 焦る\n";
      expect(forbiddenWordCheck(`<dialogue>${text}</dialogue>`, sheet).ok).toBe(true);
    });
  }

  const aseruForms: readonly string[] = ["焦らず", "焦らない", "焦って", "焦った", "焦る", "焦り"];
  for (const text of aseruForms) {
    it(`「焦る」の活用形「${text}」は落とす`, () => {
      const sheet = "【キャラカード】\nforbidden_words: 焦る\n";
      expect(forbiddenWordCheck(`<dialogue>${text}</dialogue>`, sheet).ok).toBe(false);
    });
  }

  // 活用させん語には次字の条件を付けん。「あんた」は「た」で終わるが動詞やないので、
  // 後ろに何が来ても落とす（実測: 実ログの「あ、あんた…そういえば」が消えかけた）。
  it("活用せん語は後ろの字に関係なく落とす", () => {
    const sheet = "【キャラカード】\nforbidden_words: あんた\n";
    expect(forbiddenWordCheck("<dialogue>あ、あんた…そういえば</dialogue>", sheet).ok).toBe(false);
    expect(forbiddenWordCheck("<dialogue>あんたさ、聞いてる</dialogue>", sheet).ok).toBe(false);
  });

  // 複数語の言いつけは、どこが語幹か決められんので書かれたままの形だけで照合する。
  it("複数語の言いつけはそのままの形だけで照合する", () => {
    const sheet = "【キャラカード】\nforbidden_words: 真面目に考えろ\n";
    expect(forbiddenWordCheck("<dialogue>真面目に考えろ</dialogue>", sheet).ok).toBe(false);
    expect(forbiddenWordCheck("<dialogue>真面目に考えてみて</dialogue>", sheet).ok).toBe(true);
  });
});
