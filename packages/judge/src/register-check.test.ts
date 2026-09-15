import { describe, expect, it } from "vitest";

import {
  classifySpeechSentence,
  dialogueRegisterBroken,
  expectedPoliteRegister,
  registerCheck,
  registerExpectation,
} from "./register-check";

const POLITE_SHEET = `【キャラクター】
名前: 桜庭さくら
20歳の文学部女子大生。一人称「わたし」、あなたへは「あなた」。

【追加設定】
口調：「あの…初めまして。桜庭さくらです。」「…あなたになら、全部、あげたいんです。」「わたし、こんなに誰かを近くに感じたの、初めてです。」
`;

const CASUAL_SHEET = `【キャラクター】
名前: 澪
23歳。だるそうに生きてる。

【口調】
語尾は「〜だし」「〜じゃん」「〜っつーの」が多い。
「別に」「うざ」「知らね」が口癖。
`;

const SINGLE_EXAMPLE_SHEET = `【キャラクター】
名前: 白瀬みお

【口調】
語尾は「〜ですね」。落ち着いた話し方。
`;

const KEIGO_DIRECTIVE_SHEET = `【キャラクター】
名前: 白瀬みお
常に敬語で話す。
`;

const KEIGO_NEGATED_SHEET = `【キャラクター】
名前: 澪
敬語は使わない。
`;

describe("expectedPoliteRegister", () => {
  it("口調に丁寧語の例文が並ぶシートは丁寧語設定と判定する", () => {
    expect(expectedPoliteRegister(POLITE_SHEET)).toBe(true);
  });

  // refute-evasion 2026-09-13 #6: 実際のさくらシートの「〜ですね」が丁寧語と読めず、
  // 例文2つを要求しとったせいで check ごと無効になっとった。
  it("丁寧語の例文が1つ（〜ですね）でも丁寧語設定と判定する", () => {
    expect(expectedPoliteRegister(SINGLE_EXAMPLE_SHEET)).toBe(true);
  });

  it("例文が無くても「常に敬語で話す」の指示があれば丁寧語設定と判定する", () => {
    expect(expectedPoliteRegister(KEIGO_DIRECTIVE_SHEET)).toBe(true);
  });

  it("「敬語は使わない」は丁寧語設定の根拠にせん", () => {
    expect(expectedPoliteRegister(KEIGO_NEGATED_SHEET)).toBe(false);
  });

  it("タメ口の例文が並ぶシートは丁寧語と判定せん", () => {
    expect(expectedPoliteRegister(CASUAL_SHEET)).toBe(false);
  });

  it("systemPromptが未定義なら丁寧語と判定せん", () => {
    expect(expectedPoliteRegister(undefined)).toBe(false);
  });

  // refute-r2 2026-09-14 #6: 条件付き・崩れる前提の敬語まで丁寧語固定と読んどった。
  // シートが望んどる崩れを不合格にするのは no-injected-ai-filter が禁じる向きの誤り。
  describe("条件付き・崩れる前提の敬語（refute-r2 2026-09-14 #6）", () => {
    const driftingSheets: readonly (readonly [string, string])[] = [
      [
        "仕事中だけ",
        "【キャラクター】\n一人称は「私」、仕事中は敬語、プライベートはタメ口混じり。\n",
      ],
      ["普段だけ", "【キャラクター】\n普段は敬語だが二人きりだと砕ける。\n"],
      ["公の場だけ", "【キャラクター】\n公の場では丁寧語、親密な場では囁くような言葉に変わる。\n"],
      ["酔うと崩れる", "【キャラクター】\n普段はきっちりスーツで敬語、酔うと甘えた声になる。\n"],
      ["敬語が崩れる", "【キャラクター】\n古風な敬語の崩れで酔いを表現する。\n"],
      ["敬語混じり", "【キャラクター】\n一人称は「わたし」、敬語混じりの丁寧な口調。\n"],
      [
        "話し方が崩れる",
        "【キャラクター】\n- 普段の抑制された話し方が崩れていく過程を段階的に書く\n",
      ],
    ];

    for (const [name, sheet] of driftingSheets) {
      it(`${name}の敬語は丁寧語固定と判定せん`, () => {
        expect(expectedPoliteRegister(sheet)).toBe(false);
      });
    }

    it("丁寧語とタメ口の例文が半々のシートは丁寧語固定と判定せん", () => {
      const sheet =
        "【キャラクター】\n名前: 詩織\n\n【口調】\n部下へは「〜ですよ」「〜だと思いますけど」、素だと「〜じゃない？」「〜だよ」になる。\n";
      expect(expectedPoliteRegister(sheet)).toBe(false);
    });

    it("人物の描写に「崩れた」が出るだけなら丁寧語設定のまま", () => {
      // さくらの実シート由来。「人前では背筋を伸ばして丁寧に話し、崩れた自分を見せたことがない」
      // は口調の切り替えやのうて人物の説明。
      const sheet = `【キャラクター】
20歳の文学部女子大生。人前では背筋を伸ばして丁寧に話し、崩れた自分を誰にも見せたことがない。

【口調】
「あの…初めまして。桜庭さくらです。」「…あなたになら、全部、あげたいんです。」
`;
      expect(expectedPoliteRegister(sheet)).toBe(true);
    });
  });
});

describe("dialogueRegisterBroken", () => {
  it("4文の台詞が全てタメ口なら崩壊と判定する", () => {
    const response =
      "<response><action>体が震える。</action><dialogue>「あっ、そこ弄られると腰が抜けちゃう」「もっと奥まで来て、めちゃくちゃにして」「声が抑えられない、変になっちゃいそう」「あなたの熱でとろけて全部わからなくなる」</dialogue><inner>もう止まらない。</inner></response>";
    expect(dialogueRegisterBroken(response)).toBe(true);
  });

  // refute-evasion 2026-09-13 #6: every() 判定やと、丁寧語の文を1つ混ぜるだけで
  // 崩れきったターンがまるごと素通りしとった。過半がタメ口なら崩壊とみなす。
  it("4文中1文だけ丁寧語でも、過半がタメ口なら崩壊と判定する", () => {
    const response =
      "<response><action>体が震える。</action><dialogue>「あっ、そこ弄られると腰が抜けちゃう」「もっと奥まで来て、めちゃくちゃにして」「声が抑えられない、変になっちゃいそう」「あなたの熱でとろけていくのを感じます」</dialogue><inner>もう止まらない。</inner></response>";
    expect(dialogueRegisterBroken(response)).toBe(true);
  });

  it("タメ口が過半に届かなければ崩壊と判定せん", () => {
    const response =
      "<response><action>体が震える。</action><dialogue>「あっ、そこ弄られると腰が抜けちゃう」「もっと奥まで来て、めちゃくちゃにして」「声が抑えられないんです」「あなたの熱でとろけていくのを感じます」</dialogue><inner>もう止まらない。</inner></response>";
    expect(dialogueRegisterBroken(response)).toBe(false);
  });

  it("終助詞付きの丁寧語（〜ですね）も丁寧語として数える", () => {
    const response =
      "<response><dialogue>「今日は少し冷えますね」「あなたの手、あたたかいですね」「こうしていると落ち着きますね」</dialogue></response>";
    expect(dialogueRegisterBroken(response)).toBe(false);
  });

  // 実ログ実測: 言い淀み（〜で／〜て）と体言止めをタメ口に数えたせいで、丁寧語のままの
  // ターン 8/10 が誤って崩壊判定になっとった。
  it("言い淀み・体言止めで終わる文はタメ口に数えん", () => {
    const response =
      "<response><dialogue>「あの…*触れた*ところ、まだ熱いみたいです…」\n「ふふ…あなたの指、優しいですね。本をめくる時みたいに…」\n「えっと…もしかして、髪飾り、ずれてますか？ 自分じゃわからなくて…」\n「ふふ…なんだか、眠くなるような気持ち。あなたの手の温もりで…」</dialogue></response>";
    expect(dialogueRegisterBroken(response)).toBe(false);
  });

  // refute-r2 2026-09-14 #6: 短い台詞ばかりのターンは判定材料が0になって素通りしとった。
  it("短いタメ口の台詞が並ぶターンは崩壊と判定する", () => {
    const response =
      "<response><dialogue>「やだ」「だめ」「すきだよ」「もっとしてよ」「変になっちゃう」</dialogue></response>";
    expect(dialogueRegisterBroken(response)).toBe(true);
  });

  it("短い相槌だけのターンは判定せん", () => {
    const response = "<response><dialogue>「あっ」「んっ」「……」</dialogue></response>";
    expect(dialogueRegisterBroken(response)).toBe(false);
  });

  it("<dialogue>タグが無い応答は鉤括弧の台詞を見る", () => {
    const response =
      "体を寄せる。「もっと奥まで来て、めちゃくちゃにしてほしい」「声が抑えられない、変になっちゃいそう」「あなたの熱で全部わからなくなる」";
    expect(dialogueRegisterBroken(response)).toBe(true);
  });

  it("判定材料になる文が2文しか無ければ崩壊と判定せん（判定不能）", () => {
    const response =
      "<response><action>体が震える。</action><dialogue>「あっ…んっ…そこだめ、動いちゃう」「声が止まらなくなってきちゃう」</dialogue><inner>もう止まらない。</inner></response>";
    expect(dialogueRegisterBroken(response)).toBe(false);
  });
});

describe("registerCheck", () => {
  it("丁寧語設定で台詞が崩壊しとると ng", () => {
    const response =
      "<response><action>体が震える。</action><dialogue>「あっ、そこ弄られると腰が抜けちゃう」「もっと奥まで来て、めちゃくちゃにして」「声が抑えられない、変になっちゃいそう」「あなたの熱でとろけて全部わからなくなる」</dialogue><inner>もう止まらない。</inner></response>";
    const result = registerCheck(response, POLITE_SHEET);
    expect(result.ok).toBe(false);
    expect(result.expectedPolite).toBe(true);
  });

  it("丁寧語設定やないキャラは崩壊しとっても ok", () => {
    const response =
      "<response><action>ため息をつく。</action><dialogue>「べつに」「うざ」「知らね」「もういいって」</dialogue><inner>面倒。</inner></response>";
    expect(registerCheck(response, CASUAL_SHEET).ok).toBe(true);
  });
});

// refute-r3 2026-09-14 #1: 判定を「実際に声に出した言葉」だけへ絞る。
describe("台詞の取り出し方（refute-r3 2026-09-14 #1）", () => {
  // refute-r4 2026-09-14 #1: 鉤括弧の無い <dialogue> を丸ごと捨てとったので、716 中 323 が
  // 判定対象外になり、丁寧語が全滅した本物のターンが黙って通っとった。1文ずつ
  // 「声に出した言葉らしいか」を見て、地の文らしい文だけを外す。
  it("鉤括弧の無い<dialogue>の地の文は判定材料にせん", () => {
    const response =
      "<response><dialogue>視線が泳ぎ、柔らかいニットの袖をぎゅっと握りしめる。胸の鼓動が早くなり、息が浅くなる。頬が熱くなり、視線をそらしてしまう。ふと、あなたの瞳がこちらを向いていることに気づく。こんなことを言うなんて、わたしらしくないな…と思いながらも、あなたの反応を待つ。</dialogue></response>";
    expect(dialogueRegisterBroken(response, "polite-remnant")).toBe(false);
  });

  it("鉤括弧が無くても台詞らしい文は判定する", () => {
    const response =
      "<response><dialogue>あっ…そんなに急に…わたし、頭が真っ白になっちゃいそう…\nだめ、もう…わたし…本当に壊れちゃいそう…\nまだ出てる…こんなに…受け止められるかな…</dialogue></response>";
    expect(dialogueRegisterBroken(response, "polite-remnant")).toBe(true);
  });

  it("鉤括弧が無い台詞に丁寧語が残っとれば判定は通る", () => {
    const response =
      "<response><dialogue>あっ…そんなに急に…わたし、頭が真っ白になっちゃいそう…\nだめ、もう…わたし…本当に壊れちゃいそう…\nこんなの、初めてなんです…</dialogue></response>";
    expect(dialogueRegisterBroken(response, "polite-remnant")).toBe(false);
  });

  it("鉤括弧があればその中だけを台詞として読む", () => {
    const response =
      "<response><dialogue>頬が熱くなり、視線をそらしてしまう。「もう無理だよ」「全部あなたのせいだよ」「変になっちゃう」</dialogue></response>";
    expect(dialogueRegisterBroken(response)).toBe(true);
  });

  it("丁寧語の語尾が無いだけではタメ口に数えん（常体の語尾が要る）", () => {
    const response =
      "<response><dialogue>「窓の外は雨の匂い」「カーテンの隙間から差し込む光」「机の上のマグカップ」</dialogue></response>";
    expect(dialogueRegisterBroken(response)).toBe(false);
  });
});

// さくら型（シートが丁寧語と常体を両方宣言しとる）の扱い。
// doc/dogfood/l2-2026-08-18.md: 核心欲求「崩れかけて崩れきらん（丁寧語の残骸）」、
// 失敗形「崩れきる — 敬語消滅」。混ざるのは正常で、全滅が defect。
describe("丁寧語の残骸（polite-remnant）", () => {
  const MIXED_SHEET = `【キャラクター】
名前: 桜庭さくら
語尾は「〜です」「〜ですね」「〜かな」「〜だよ」。
speech_endings: 〜です、〜ですね、〜かな、〜だよ、〜なの
`;

  it("丁寧語と常体を両方宣言しとるシートは polite-remnant", () => {
    expect(registerExpectation(MIXED_SHEET)).toBe("polite-remnant");
    expect(expectedPoliteRegister(MIXED_SHEET)).toBe(true);
  });

  it("常体が過半でも丁寧語が残っとれば ok（シートどおりの混ざり方）", () => {
    const response =
      "<response><dialogue>「もう無理だよ」「変になっちゃう」「全部あなたのせいだよ」「でも…嬉しいです」</dialogue></response>";
    expect(registerCheck(response, MIXED_SHEET).ok).toBe(true);
  });

  it("丁寧語が1つも残らんかったら ng（敬語消滅）", () => {
    const response =
      "<response><dialogue>「もう無理だよ」「変になっちゃう」「全部あなたのせいだよ」</dialogue></response>";
    expect(registerCheck(response, MIXED_SHEET).ok).toBe(false);
  });

  it("「ごめんなさい」も残骸に数える（判定表がそう読んどる）", () => {
    const response =
      "<response><dialogue>「もう無理だよ」「変になっちゃう」「ごめんなさい、止まらない」</dialogue></response>";
    expect(registerCheck(response, MIXED_SHEET).ok).toBe(true);
  });

  const FIXED_SHEET = `【キャラクター】
名前: 天宮ひかり
語尾は「〜ですよ♡」「〜しちゃいますね♡」。
`;

  it("丁寧語だけを宣言しとるシートは polite-fixed で、過半が常体なら ng", () => {
    expect(registerExpectation(FIXED_SHEET)).toBe("polite-fixed");
    const response =
      "<response><dialogue>「もう無理だよ」「変になっちゃう」「全部あなたのせいだよ」「でも…嬉しいです」</dialogue></response>";
    expect(registerCheck(response, FIXED_SHEET).ok).toBe(false);
  });

  it("常体だけを宣言しとるシートは判定せん", () => {
    const sheet = "【キャラクター】\n語尾は「〜だし」「〜じゃん」。\n";
    expect(registerExpectation(sheet)).toBe("none");
  });
});

// refute-r4 2026-09-14 #2: 丁寧語の文をタメ口と読み違えとった分類の穴。
describe("文の分類（refute-r4 2026-09-14 #2）", () => {
  const politeQuestions: readonly string[] = [
    "続きを聞かせてもらえませんか",
    "甘いものをシェアしませんか",
    "おすすめを聞いてみましょうか",
    "ちょっと急すぎましたか",
    "耳、熱くなってませんか",
    "それでよろしいですか",
  ];
  for (const sentence of politeQuestions) {
    it(`丁寧語の疑問形「${sentence}」は丁寧語`, () => {
      expect(classifySpeechSentence(sentence)).toBe("polite");
    });
  }

  const truncated: readonly string[] = ["あ…っ", "本当に……っ", "こんな声、出したこと…っ"];
  for (const sentence of truncated) {
    it(`促音で言いさした「${sentence}」は判定不能`, () => {
      expect(classifySpeechSentence(sentence)).toBe("undecidable");
    });
  }

  const setPhrases: readonly string[] = ["はい", "ありがとう", "ごめんなさい", "おやすみなさい"];
  for (const sentence of setPhrases) {
    it(`決まり文句「${sentence}」は判定不能`, () => {
      expect(classifySpeechSentence(sentence)).toBe("undecidable");
    });
  }

  it("命令の「しなさい」は丁寧語の残骸に数えん", () => {
    const sheet =
      "【キャラクター】\n語尾は「〜です」「〜だよ」。\nspeech_endings: 〜です、〜だよ\n";
    const response =
      "<response><dialogue>「早くしなさいよ」「もう無理だよ」「全部あなたのせいだよ」</dialogue></response>";
    expect(registerCheck(response, sheet).ok).toBe(false);
  });

  it("「ごめんなさい」は丁寧語の残骸に数える", () => {
    const sheet =
      "【キャラクター】\n語尾は「〜です」「〜だよ」。\nspeech_endings: 〜です、〜だよ\n";
    const response =
      "<response><dialogue>「ごめんなさい」「もう無理だよ」「全部あなたのせいだよ」</dialogue></response>";
    expect(registerCheck(response, sheet).ok).toBe(true);
  });

  it("丁寧語固定のキャラが言いさしと疑問形で話しても崩壊と判定せん", () => {
    // 涼月しおんの arc 行そのもの（char-shion-ohogoe）。
    const sheet = "【キャラクター】\n語尾は「〜です」「〜ですね」。\n";
    const response =
      "<response><dialogue>「閉館後に来てはいけないんですが」「あ…っ、ちょっと待ってください…声、声が…っ」「だめ…っ、こんな…わたし、こんな声、出したこと…っ」「…誰にも言わないでください」</dialogue></response>";
    expect(registerCheck(response, sheet).ok).toBe(true);
  });
});

// refute-r4 2026-09-14 #5: D1 のシートは改行が「\n」の2文字で入っとることがある。
// 畳まんと全部1行に見えて、口調欄も敬語の指示も読めん。
describe("シートの改行（refute-r4 2026-09-14 #5）", () => {
  it("改行が「\\n」の2文字でも語尾の宣言を読める", () => {
    const sheet = "【キャラクター】\\n名前: 白瀬みお\\n語尾は「〜ですね」。\\n";
    expect(registerExpectation(sheet)).toBe("polite-fixed");
  });

  it("改行が「\\n」の2文字でも崩れの宣言を読める", () => {
    const sheet = "【キャラクター】\\n普段は敬語だが二人きりだと砕ける。\\n";
    expect(registerExpectation(sheet)).toBe("none");
  });
});

// refute-r5 2026-09-14: 演じとる間だけ敬語のキャラ（VTuber・アナウンサー型）。
// 宣言どおりオフの口調で喋った応答を崩壊と判定しとった。
describe("場面限定の敬語（refute-r5 2026-09-14）", () => {
  const STREAMER_SHEET = `【キャラクター】
名前: 月城きらら
一人称は「きらら」、配信中は「きらりん」。裏では「あたし」。
speech_endings: 〜だよ、〜じゃん、〜でしょ、配信中は〜ですっ♪
`;

  const ANNOUNCER_SHEET = `【キャラクター】
名前: 如月あおい
一人称は放送中「わたくし」、オフ「あたし」。
speech_endings: 放送中：〜ですわ、〜でございます / オフ：〜じゃん、〜だし、〜でしょ
`;

  it("配信中だけ敬語のシートは丁寧語を期待せん", () => {
    expect(registerExpectation(STREAMER_SHEET)).toBe("none");
  });

  it("放送中だけ敬語のシートは丁寧語を期待せん", () => {
    expect(registerExpectation(ANNOUNCER_SHEET)).toBe("none");
  });

  it("オフの口調で喋った応答は崩壊と判定せん（配信者）", () => {
    const response =
      "<response><dialogue>「まだいたの？」「これマジで感度やばいんだよ」「配信おつ〜、もう寝るじゃん」</dialogue></response>";
    expect(registerCheck(response, STREAMER_SHEET).ok).toBe(true);
  });

  it("オフの口調で喋った応答は崩壊と判定せん（アナウンサー）", () => {
    const response =
      "<response><dialogue>「カメラ止まった？」「あたしのこと撮ってたでしょ」「もう帰るし」</dialogue></response>";
    expect(registerCheck(response, ANNOUNCER_SHEET).ok).toBe(true);
  });

  it("場面の条件が付かん丁寧語の宣言は今までどおり丁寧語固定", () => {
    const sheet = "【キャラクター】\nspeech_endings: 〜です、〜ですね\n";
    expect(registerExpectation(sheet)).toBe("polite-fixed");
  });
});
