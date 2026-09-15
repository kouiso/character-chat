import { describe, expect, it } from "vitest";

import { checkRepeatedVocativeLead, runQualityChecks } from "../quality-guard";

import type { QualityCheckContext } from "../quality-guard";

// 局長 2026-08-17 (backlog C6): 1 つの返事の中で「コウスケさん…」＋三点リーダの台詞が
// 6 行続いた。「あなた。がくどい」「基礎的な文章が不自然すぎる」。名前を登録した副作用で
// 「あなた」の杖が名前の杖に変わっただけで、症状は同じ骨格の連投やった。
//
// 既存の within-turn 反復（hasSimilarSentences / hasSubstringRepetition）は**文全体**の
// 一致率を見る。呼びかけだけを共有して残りが違う 6 行は bigram Jaccard が 0.2 前後にしか
// ならず、閾値 0.72 を一度も越えん。見とる場所が違うので、閾値を動かしても届かん。

const reply = (blocks: readonly (readonly [string, string])[], inner: string) =>
  `<response>${blocks
    .map(([action, dialogue]) => `<action>${action}</action><dialogue>${dialogue}</dialogue>`)
    .join("")}<inner>${inner}</inner></response>`;

// 局長の報告した形。呼びかけ以外は毎行違う中身にしてある（文全体の反復では落ちん形）。
const vocativeWall = reply(
  [
    [
      "ベンチの端に腰を下ろし、鞄の持ち手を握り直す。",
      "「コウスケさん…今日は、ありがとうございました」",
    ],
    ["風で乱れた前髪を耳にかける。", "「コウスケさん…あの本、まだ読み終わってなくて」"],
    ["足元の落ち葉を靴先で寄せる。", "「コウスケさん…来週も、ここに来ますか？」"],
    ["湯気の立つ缶を両手で包む。", "「コウスケさん…紅茶、飲めますよね」"],
    ["改札の方をちらりと見る。", "「コウスケさん…電車、まだ大丈夫ですか」"],
    ["鞄の肩紐を掛け直して立ち上がる。", "「コウスケさん…また明日、話したいです」"],
  ],
  "帰したくない。でも引き止める言葉が出てこない。",
);

// 実測 2026-08-16 phase4 Downer t5（記録そのまま）。呼びかけは「あんた」1 回と「きみ」2 回。
// 6 行中 3 行が呼びかけで始まっとるが、呼び方が散っとるので骨格の連投には読めん。
const mixedPronouns = reply(
  [
    [
      "きみの言葉に、首元のピアスが触れるほど顔を近づけてしまう。",
      "「……あんた、本当に困った子だね。勝手に人のピアスなんて見て……」",
    ],
    [
      "きみの冷たい指先が首筋を探り、背筋がぞくっと震える。",
      "「……っ。ちょっと、そこ触らないでよ。めんどくさい……」",
    ],
    [
      "きみの手のひらが頬に触れ、その冷たさに目を細める。",
      "「……はぁ。あんたみたいな人、初めてだよ。こんな雨の夜に……」",
    ],
    [
      "きみの指がピアスをゆっくり回す。金属の冷たさと指の温もりが混ざる。",
      "「……きみ、本当に……厄介な人だ。私のピアス、そんなに気になる？」",
    ],
    [
      "チョーカーの金具をいじられ、首が締め付けられる感覚に目が潤む。",
      "「……もう、いい加減にしてよ。私の首輪、そんなにおもしろい？」",
    ],
    [
      "きみの腰を引き寄せ、二人の体がぴったりと密着する。",
      "「……きみ、私のこと……本当に、困らせるつもり？」",
    ],
  ],
  "やばい、本当にやばい。こんなに簡単に主導権を奪われて、情けない。",
);

// 実測 2026-08-16 baseline Sakura t2（記録そのまま）。11 行のうち 5 行が「あの…」で始まる。
// これはさくらの口癖＝声で、既存ガードも通しとる。呼びかけの連投とは別物。
const voiceTicWall = reply(
  [
    [
      "メニューを覗き込みながら、髪飾りに触れる癖が出る。",
      "「あの…わたし、実は甘いものに目がないんです」",
    ],
    [
      "店内のケースへ視線を移す。",
      "「でも、あなたがおすすめしてくれるなら、コーヒーでも嬉しいです」",
    ],
    ["肩をすくめて小さく笑う。", "「ふふ…初めて会った人と好みを話し合うの、なんだか新鮮です」"],
    ["指先でメニューの角をなぞる。", "「あの…もしよかったら、今日は甘いものをシェアしませんか？」"],
    ["カフェオレの写真を指さす。", "「あの…この髪飾り、桜の形なんです」"],
    ["店員さんの方をちらりと見る。", "「あの…もし迷ってたら、おすすめを聞いてみましょうか？」"],
    ["椅子に座り直して息を吐く。", "「あの…次はあなたの好きなカフェにも連れて行ってほしいです」"],
  ],
  "こんなに話が続くなんて思わなかった。もう少しだけ、一緒にいたい。",
);

// 実測 2026-08-17 phase10 Sakura t4 由来。「あなた」は主語位置で、呼びかけやない。
const subjectPosition = reply(
  [
    ["繋いだ手をそっと持ち上げて見つめる。", "「あっ…あなたの手、大きいですね…」"],
    ["指の付け根に触れて首をかしげる。", "「あなたの手、とっても暖かい…」"],
    ["手のひらの小さな傷をなぞる。", "「あなたの指、少し冷たいですね…」"],
    ["自分の手のひらを並べて比べる。", "「あなたの手、すごくきれいだなって…」"],
  ],
  "この手をずっと握っていたい。離したくない。",
);

const conversationContext: QualityCheckContext = {
  phase: "conversation",
  characterName: "桜庭さくら",
  userName: "コウスケ",
};

describe("1 つの返事の中で同じ呼びかけを連投する骨格", () => {
  it("「コウスケさん…」で始まる台詞が 6 行続いたら落とす", () => {
    expect(checkRepeatedVocativeLead(vocativeWall, "コウスケ")).toBe(false);
  });

  it("runQualityChecks が within-turn-vocative-lead として repetition に分類する", () => {
    const result = runQualityChecks(vocativeWall, conversationContext);

    expect(result.failedCheck).toBe("within-turn-vocative-lead");
    expect(result.category).toBe("repetition");
  });

  it("既存の文全体の反復チェックでは届かん（呼びかけを外すと同じ本文が通る）", () => {
    const withoutVocative = vocativeWall.replace(/コウスケさん…/g, "");

    expect(runQualityChecks(withoutVocative, conversationContext).passed).toBe(true);
  });

  it("名前が未登録でも二人称の連投は同じ扱い", () => {
    const pronounWall = vocativeWall.replace(/コウスケさん…/g, "あなた…");

    expect(checkRepeatedVocativeLead(pronounWall, undefined)).toBe(false);
  });
});

describe("キャラの声は落とさん", () => {
  it("呼び方が散っとる 3 行は通す（実測 phase4 Downer t5）", () => {
    expect(checkRepeatedVocativeLead(mixedPronouns, "コウスケ")).toBe(true);
  });

  it("口癖「あの…」が 5 行続いても通す（実測 baseline Sakura t2）", () => {
    expect(checkRepeatedVocativeLead(voiceTicWall, "コウスケ")).toBe(true);
  });

  it("主語位置の「あなたの手」は呼びかけやないので通す（実測 phase10 Sakura t4）", () => {
    expect(checkRepeatedVocativeLead(subjectPosition, "コウスケ")).toBe(true);
  });

  it("語尾の口癖は数えん", () => {
    const suffixTic = reply(
      [
        ["俯いたまま指を絡ませる。", "「恥ずかしい…なの」"],
        ["肩を小さく揺らす。", "「離したくない…なの」"],
        ["顔を上げて目を細める。", "「もっと近くにいたい…なの」"],
        ["袖口を握って息を吐く。", "「明日も会いたい…なの」"],
      ],
      "こんなことを言う自分が信じられない。",
    );

    expect(checkRepeatedVocativeLead(suffixTic, "コウスケ")).toBe(true);
  });

  it("台詞が 1 行だけなら呼びかけで始まっても通す", () => {
    const single = reply(
      [["缶を両手で包んで俯く。", "「コウスケさん…少しだけ、待ってもらえますか」"]],
      "行かないでほしい。",
    );

    expect(checkRepeatedVocativeLead(single, "コウスケ")).toBe(true);
  });

  it("呼びかけ 2 行は通す（実測で健全な返事の上限）", () => {
    const twice = reply(
      [
        ["鞄の持ち手を握り直す。", "「コウスケさん…今日は、ありがとうございました」"],
        ["前髪を耳にかける。", "「あの本、まだ読み終わってなくて」"],
        ["改札の方をちらりと見る。", "「コウスケさん…電車、まだ大丈夫ですか」"],
        ["肩紐を掛け直して立ち上がる。", "「また明日、話したいです」"],
      ],
      "帰したくない。",
    );

    expect(checkRepeatedVocativeLead(twice, "コウスケ")).toBe(true);
  });

  it("敬称が違っても同じ呼び方として数える", () => {
    const honorificMix = reply(
      [
        ["鞄の持ち手を握り直す。", "「コウスケさん…今日は、ありがとうございました」"],
        ["前髪を耳にかける。", "「コウスケくん…あの本、まだ読み終わってなくて」"],
        ["改札の方をちらりと見る。", "「コウスケ、電車はまだ大丈夫ですか」"],
      ],
      "帰したくない。",
    );

    expect(checkRepeatedVocativeLead(honorificMix, "コウスケ")).toBe(false);
  });
});

// 自分の実装を壊しにいって出てきた 2 件。
describe("取りこぼしと誤検出の穴", () => {
  it("1 つの <dialogue> に改行無しで並んだ台詞も数える", () => {
    const packed =
      "<response><action>ベンチの端に腰を下ろし、鞄の持ち手を握り直す。</action>" +
      "<dialogue>「コウスケさん…今日は、ありがとうございました」" +
      "「コウスケさん…あの本、まだ読み終わってなくて」" +
      "「コウスケさん…電車、まだ大丈夫ですか」</dialogue>" +
      "<inner>帰したくない。</inner></response>";

    expect(checkRepeatedVocativeLead(packed, "コウスケ")).toBe(false);
  });

  // 「ん…」「あ…」は喘ぎの頭で、実測 373 ターン中 6 ターンに出る。1 文字の仮名を
  // 登録名として当てると、その 6 ターンを呼びかけの連投として撮り直させてまう。
  it("1 文字の仮名の登録名は当てん（喘ぎの頭と見分けが付かん）", () => {
    const moans = reply(
      [
        ["背中を反らせてシーツを掴む。", "「ん…もう、だめ…」"],
        ["腰が跳ねて息が詰まる。", "「ん…そこ、変になる…」"],
        ["爪が肩に食い込む。", "「ん…お願い、離さないで…」"],
      ],
      "頭の中が白くなる。",
    );

    expect(checkRepeatedVocativeLead(moans, "ん")).toBe(true);
  });

  it("1 文字でも漢字の登録名は当てる", () => {
    const kanjiName = reply(
      [
        ["鞄の持ち手を握り直す。", "「鈴さん…今日は、ありがとうございました」"],
        ["前髪を耳にかける。", "「鈴さん…あの本、まだ読み終わってなくて」"],
        ["改札の方をちらりと見る。", "「鈴さん…電車、まだ大丈夫ですか」"],
      ],
      "帰したくない。",
    );

    expect(checkRepeatedVocativeLead(kanjiName, "鈴")).toBe(false);
  });
});
