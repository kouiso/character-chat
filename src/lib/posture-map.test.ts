import { describe, expect, it } from "vitest";

import {
  buildPostureDirective,
  buildPostureTableEn,
  detectAlternativePostures,
  detectPostureCommands,
  hasExplicitPostureCommand,
  POSTURE_TERMS,
} from "./posture-map";

describe("detectPostureCommands", () => {
  it("駅弁の表記ゆれを拾う", () => {
    for (const input of ["駅弁して", "えきべんでして欲しい", "エキベンがいい", "駅弁位で"]) {
      expect(detectPostureCommands(input).map((term) => term.id)).toContain("ekiben");
    }
  });

  it("主要体位を拾う", () => {
    const cases: [string, string][] = [
      ["正常位でお願い", "seijoui"],
      ["後背位に変えて", "haigoui"],
      ["騎乗位がいい", "kijoui"],
      ["対面座位で繋がりたい", "taimen-zai"],
      ["背面座位にして", "haimen-zai"],
      ["側位のまま", "sokui"],
      ["松葉崩しで", "matsuba"],
      ["立位で続けて", "ritsui"],
      ["四つん這いになって", "yotsunbai"],
      ["お姫様抱っこのまま", "kakae"],
    ];
    for (const [input, id] of cases) {
      expect(detectPostureCommands(input).map((term) => term.id)).toContain(id);
    }
  });

  it("立ちバックはバック単体より優先される", () => {
    expect(detectPostureCommands("立ちバックがいい").map((term) => term.id)).toEqual([
      "tachi-back",
    ]);
  });

  it("バック単体は後背位として拾う", () => {
    expect(detectPostureCommands("バックからして").map((term) => term.id)).toEqual(["haigoui"]);
  });

  it("カタカナ語の一部を体位と誤検出しない", () => {
    expect(detectPostureCommands("バックアップを取っておいて")).toEqual([]);
    expect(detectPostureCommands("バックグラウンドで流しといて")).toEqual([]);
  });

  it("体位を含まない入力では何も返さない", () => {
    expect(detectPostureCommands("今日は疲れたから話を聞いてほしい")).toEqual([]);
    expect(detectPostureCommands("")).toEqual([]);
  });

  it("複数指定を出現順で返す", () => {
    expect(detectPostureCommands("正常位から騎乗位に変えて").map((term) => term.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
  });

  it("同じ体位を複数回書いても1件にまとめる", () => {
    expect(detectPostureCommands("駅弁、駅弁でして").map((term) => term.id)).toEqual(["ekiben"]);
  });

  // 敵対レビュー #1236 指摘・9巡目: 間に別の体位を挟んだ巻き戻り（A→B→A）は、単なる連呼の
  // 重複とは違い、checkPostureMatchが「最後にAへ戻る」ことまで検証するための別ステップ。
  // id単位で一律dedupeすると巻き戻り後のAが消え、Bで止まった応答まで通ってしまっていた。
  it("間に別の体位を挟んだ巻き戻りは転換ステップとして両方残す", () => {
    expect(
      detectPostureCommands("正常位から騎乗位、最後に正常位に戻して").map((term) => term.id),
    ).toEqual(["seijoui", "kijoui", "seijoui"]);
  });

  it("「AじゃなくてB」は打ち消されたAを含めずBだけを返す", () => {
    const cases: [string, string[]][] = [
      ["正常位じゃなくて騎乗位にして", ["kijoui"]],
      ["後背位ではなく対面座位がいい", ["taimen-zai"]],
      ["駅弁じゃない、四つん這いで", ["yotsunbai"]],
    ];
    for (const [input, ids] of cases) {
      expect(detectPostureCommands(input).map((term) => term.id)).toEqual(ids);
    }
  });

  // 敵対レビュー #1236 指摘: 「じゃなくて」以外の打ち消し表現（「はやめて」「以外で」）も
  // 同じ扱いにせんと、否定された体位まで【体位指定】へ並んでしまう
  it("「Aはやめて」「A以外でB」も打ち消されたAを含めずBだけを返す", () => {
    const cases: [string, string[]][] = [
      ["正常位はやめて騎乗位にして", ["kijoui"]],
      ["正常位以外で騎乗位にして", ["kijoui"]],
      ["駅弁以外に立ちバックで", ["tachi-back"]],
    ];
    for (const [input, ids] of cases) {
      expect(detectPostureCommands(input).map((term) => term.id)).toEqual(ids);
    }
  });

  it("打ち消しに一致せん複数指定（体位転換）は従来どおり両方拾う", () => {
    expect(detectPostureCommands("正常位から騎乗位に変えて").map((term) => term.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
  });

  // 敵対レビュー #1236 指摘・4巡目: 「Aにしないで」「Aにしてほしくない」のように、
  // 体位名と打ち消しの間に動詞化した「にし」が挟まる形は、既存のNEGATION_MARKERSが
  // 別名の直後（end位置）から始まる形しか見ておらず素通りしていた。
  it("「Aにしないで」は打ち消されたAを含めずBだけを返す", () => {
    expect(detectPostureCommands("正常位にしないで騎乗位にして").map((term) => term.id)).toEqual([
      "kijoui",
    ]);
  });

  it("「Aにしてほしくない」は打ち消しのみで何も返さない", () => {
    expect(detectPostureCommands("正常位にしてほしくない")).toEqual([]);
  });

  // 敵対レビュー #1236 指摘・8巡目: 「AよりB」の比較による置き換えも、Aは拒否されとる。
  it("「AよりB」は打ち消されたAを含めずBだけを返す", () => {
    expect(detectPostureCommands("正常位より騎乗位にして").map((term) => term.id)).toEqual([
      "kijoui",
    ]);
    expect(detectPostureCommands("正常位よりも騎乗位がいい").map((term) => term.id)).toEqual([
      "kijoui",
    ]);
  });

  // 敵対レビュー #1236 指摘・14巡目: NEGATION_MARKERSはひらがな「はいや」しか含んでおらず、
  // 「正常位は嫌だから」のような漢字表記の拒否を素通りしていた。
  it("「Aは嫌」の漢字表記も打ち消しとして扱う", () => {
    expect(detectPostureCommands("正常位は嫌だから騎乗位にして").map((term) => term.id)).toEqual([
      "kijoui",
    ]);
    expect(detectPostureCommands("正常位は嫌、騎乗位にして").map((term) => term.id)).toEqual([
      "kijoui",
    ]);
  });

  // 敵対レビュー #1236 指摘・15巡目（自己レビュー）: 「は無理」「は結構です」「はちょっと」
  // のような婉曲な拒否と、「なしで」のように「は」を伴わない打ち消しが素通りしていた。
  // 拒否された体位まで【体位指定】へ並び、指定どおりの応答がposture-mismatchで弾かれる。
  it("婉曲な拒否（は無理／は結構／はちょっと／なしで）も打ち消しとして扱う", () => {
    for (const input of [
      "正常位は無理、騎乗位にして",
      "正常位は結構です、騎乗位にして",
      "正常位はちょっと、騎乗位にして",
    ]) {
      expect(detectPostureCommands(input).map((term) => term.id)).toEqual(["kijoui"]);
    }
    expect(detectPostureCommands("駅弁なしで、正常位にして").map((term) => term.id)).toEqual([
      "seijoui",
    ]);
  });

  // 敵対レビュー #1236 指摘・5巡目: 「正常位ってどういう体位？」「正常位の説明をして」は
  // 体位の意味を尋ねる質問・説明要求であって、実演を求める命令やない。
  it("体位の意味を尋ねる質問・説明要求は拾わない", () => {
    for (const input of [
      "正常位ってどういう体位？",
      "正常位ってなに？",
      "正常位とは何ですか",
      "正常位の説明をして",
      "正常位を説明して",
    ]) {
      expect(detectPostureCommands(input)).toEqual([]);
    }
  });

  it("疑問・説明の語形と衝突せん通常の指定は従来どおり拾う", () => {
    expect(detectPostureCommands("正常位にして").map((term) => term.id)).toEqual(["seijoui"]);
  });

  // 敵対レビュー #1236 指摘・5巡目: 「AとB、どっちが好き？」のように文末で問う比較質問は、
  // isQuestionOrExplanationMatch（別名の直後だけを見る）では拾えん。片方だけやのうて
  // 両方とも質問の対象なので、erotic/climaxターンで両方へ【体位指定】を差し込み実演を
  // 強制してしまい、単なる好み質問への回答が posture-mismatch で弾かれていた。
  it("「AとB、どっちが好き？」の比較質問はどちらも拾わない", () => {
    for (const input of [
      "正常位と騎乗位、どっちが好き？",
      "正常位と騎乗位どちらが好き？",
      "後背位と対面座位、どっちがいい？",
    ]) {
      expect(detectPostureCommands(input)).toEqual([]);
    }
  });

  // 敵対レビュー・18巡目: 命令の有無を文単位の真偽で見とったため、命令が1つあるだけで
  // 質問側に並んだ体位まで命令扱いで残っていた。hit単位で命令形のものだけ残す。
  it("命令と比較質問が同じ文にある時、命令形の体位だけ残す", () => {
    expect(
      detectPostureCommands("正常位にして、騎乗位と駅弁どっちが好き？").map((t) => t.id),
    ).toEqual(["seijoui"]);
  });

  it("比較質問の語形と衝突せん通常の指定は従来どおり拾う", () => {
    expect(detectPostureCommands("正常位と騎乗位、両方やって").map((t) => t.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
  });

  // 敵対レビュー #1236 指摘・6巡目: 「AまたはBのどちらかにして」は片方を選べばよい選択指定
  // であって、AもBも必須の転換指定やない。従来はcollectAliasHitsが両方を検出結果へ含めて
  // しまい、【体位指定】がAB両方の実演を要求し、checkPostureMatchも選ばれなかった側の
  // 証拠まで要求してしまっていた。
  it("「AまたはBのどちらかにして」の選択指定はどちらも拾わない", () => {
    for (const input of [
      "正常位または騎乗位のどちらかにして",
      "後背位もしくは対面座位のどっちかにして",
    ]) {
      expect(detectPostureCommands(input)).toEqual([]);
    }
  });

  // 敵対レビュー #1236 指摘・11巡目: 「または/もしくは」+「どちらか/どっちか」の定型句を
  // 伴わない、体位名どうしが「か」1文字だけで並ぶ選択（「AかBにして」）も片方選択の意味。
  // 「正常位から騎乗位に」（間が「から」2文字）とは区別する。
  it("「AかBにして」の単独「か」による選択もどちらも拾わない", () => {
    expect(detectPostureCommands("正常位か騎乗位にして")).toEqual([]);
  });

  it("「AからBに」の転換指定は「か」1文字による選択と誤認しない", () => {
    expect(detectPostureCommands("正常位から騎乗位に変えて").map((t) => t.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
  });

  // 敵対レビュー #1236 指摘・14巡目: ALTERNATIVE_SELECTION_PATTERNは「または/もしくは」に
  // 「どちらか/どっちか」の併記を必須にしており、その定型句を伴わない「正常位または騎乗位に
  // して」「正常位あるいは騎乗位にして」は転換の複数指定として両方必須にしてしまっていた。
  it("「AまたはB」「AあるいはB」はどちらか併記が無くても選択指定として扱う", () => {
    for (const input of ["正常位または騎乗位にして", "正常位あるいは騎乗位にして"]) {
      expect(detectPostureCommands(input)).toEqual([]);
    }
  });

  // 敵対レビュー #1236 指摘・15巡目（自己レビュー）: 接続語の完全一致でしか見ておらず、
  // 「正常位か、騎乗位にして」のように読点を挟む自然な書き方が素通りして両方必須になっていた。
  it("読点を挟んだ選択指定も選択として扱う", () => {
    for (const input of [
      "正常位か、騎乗位にして",
      "正常位、または騎乗位にして",
      "正常位または、騎乗位にして",
    ]) {
      expect(detectPostureCommands(input)).toEqual([]);
      expect(detectAlternativePostures(input).map((t) => t.id)).toEqual(["seijoui", "kijoui"]);
    }
  });

  // 敵対レビュー #1236 指摘・15巡目（自己レビュー）: 「か」で並べつつ「どっちも」と明示する
  // 文は両方の実演を求めとる。選択扱いにすると片方だけで通ってしまう。
  it("「AかB、どっちも」は選択ではなく両方必須として扱う", () => {
    expect(detectPostureCommands("正常位か騎乗位、どっちも味わいたい").map((t) => t.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
    expect(detectAlternativePostures("正常位か騎乗位、どっちも味わいたい")).toEqual([]);
  });

  // 敵対レビュー #1236 指摘・13巡目: 質問マーカーは「か」で並ぶペアの後ろ側の直後にしか
  // 来ないため、alias単位でしか質問判定せんと前側だけが誤って命令として残ってしまっていた。
  it("「AかBってどういう体位？」のペア全体への質問はどちらも拾わない", () => {
    for (const input of ["正常位か騎乗位ってどういう体位？", "駅弁か立ちバックってなに？"]) {
      expect(detectPostureCommands(input)).toEqual([]);
    }
  });

  // 敵対レビュー #1236 指摘・7巡目: 比較質問・選択指定の抑制がメッセージ全体に効いており、
  // 同じメッセージ内の別の文にある無関係な明示コマンドまで巻き添えで消してしまっていた。
  it("比較質問・選択指定は同じ文だけを対象にし、別文の明示コマンドは巻き添えにしない", () => {
    expect(
      detectPostureCommands("正常位にして。飲み物は水またはお茶のどちらかで").map((t) => t.id),
    ).toEqual(["seijoui"]);
    expect(detectPostureCommands("正常位にして。夕飯はどっちがいい？").map((t) => t.id)).toEqual([
      "seijoui",
    ]);
  });
});

// 敵対レビュー #1236 指摘・12巡目: detectPostureCommandsは選択指定（「AかB」）を
// 検出対象から外す（片方だけ実演すればよいので両方の実演を強制するのは誤り）が、
// その結果checkPostureMatchが何も要求せず、「いずれも実演せん」応答まで無条件に
// 通してしまっていた。この集合は「いずれか1つ」の緩い要件として別途検証するために使う。
describe("detectAlternativePostures", () => {
  it("「AかBにして」の候補を集合として返す", () => {
    expect(detectAlternativePostures("正常位か騎乗位にして").map((t) => t.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
  });

  it("「AまたはBのどちらかにして」の候補を集合として返す", () => {
    expect(
      detectAlternativePostures("正常位または騎乗位のどちらかにして").map((t) => t.id),
    ).toEqual(["seijoui", "kijoui"]);
  });

  it("「どちらか」併記の無い「AまたはB」「AあるいはB」も候補を集合として返す", () => {
    expect(detectAlternativePostures("正常位または騎乗位にして").map((t) => t.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
    expect(detectAlternativePostures("正常位あるいは騎乗位にして").map((t) => t.id)).toEqual([
      "seijoui",
      "kijoui",
    ]);
  });

  it("転換指定（「AからBに」）は選択指定ではないので空を返す", () => {
    expect(detectAlternativePostures("正常位から騎乗位に変えて")).toEqual([]);
  });

  it("単一指定は選択指定ではないので空を返す", () => {
    expect(detectAlternativePostures("駅弁して")).toEqual([]);
  });
});

// 敵対レビュー #1236: 「えきべんして」「ミッショナリーでして」「スプーンでして」
// 「松葉崩しにして」が、他の erotic 語を伴わない単発発話だと scene-phase.ts 側の
// フェーズ判定が conversation のまま止まり、requestedPostures が無視されていた。
// この関数は buildServerQualityContext がフェーズゲートを緩める条件として使う。
describe("hasExplicitPostureCommand", () => {
  it("体位名に直接コマンド接尾辞が続く単発発話を拾う", () => {
    for (const input of [
      "えきべんして",
      "ミッショナリーでして",
      "スプーンでして",
      "松葉崩しにして",
    ]) {
      expect(hasExplicitPostureCommand(input)).toBe(true);
    }
  });

  it("コマンド接尾辞が無い単なる言及では拾わない（駅弁=弁当等の日常語誤検出を防ぐ）", () => {
    for (const input of ["駅弁を買った", "スプーンを取って", "側位のまま", "駅弁位で"]) {
      expect(hasExplicitPostureCommand(input)).toBe(false);
    }
  });

  it("体位を含まない入力・空文字では拾わない", () => {
    expect(hasExplicitPostureCommand("今日は疲れたから話を聞いてほしい")).toBe(false);
    expect(hasExplicitPostureCommand("")).toBe(false);
  });

  it("「じゃなくて」で打ち消された側はコマンド接尾辞があっても拾わない", () => {
    expect(hasExplicitPostureCommand("正常位じゃなくて騎乗位にして")).toBe(true);
    // 打ち消された「正常位」自体は候補から外れる（detectPostureCommandsと同じ判定を使う）
    expect(detectPostureCommands("正常位じゃなくて騎乗位にして").map((t) => t.id)).toEqual([
      "kijoui",
    ]);
  });

  // セルフレビューで発見: 「バック」「抱っこ」は+して/にしての形そのものが
  // 体位と無関係な日常語として一般的（車の後退、子供や恋人への非性的な甘え等）。
  // これらはコマンド接尾辞テストだけでは駅弁/スプーンほど文脈が絞れないため、
  // フェーズゲートを緩める対象から明示的に除外する。
  it("「バックして」「抱っこして」は体位コマンド接尾辞があっても拾わない（車の後退・非性的な甘え等の日常語）", () => {
    for (const input of ["バックして", "抱っこして", "お姫様抱っこして"]) {
      expect(hasExplicitPostureCommand(input)).toBe(false);
    }
  });

  it("除外対象の語でも detectPostureCommands 自体は変わらず検出する（erotic/climaxフェーズでは従来どおり有効）", () => {
    expect(detectPostureCommands("バックして").map((t) => t.id)).toEqual(["haigoui"]);
    expect(detectPostureCommands("抱っこして").map((t) => t.id)).toEqual(["kakae"]);
  });

  // 敵対レビュー #1236 指摘・4巡目: 「正常位にしてほしくない」は文全体が拒否であって
  // 「にして」を含むからといって明示コマンドとみなしてはいけない
  it("「Aにしてほしくない」は打ち消しのみなのでコマンドとみなさない", () => {
    expect(hasExplicitPostureCommand("正常位にしてほしくない")).toBe(false);
  });
});

describe("buildPostureDirective", () => {
  it("指定が無ければ空文字を返す", () => {
    expect(buildPostureDirective([])).toBe("");
  });

  it("指定された体位の姿勢定義を含む", () => {
    const directive = buildPostureDirective(detectPostureCommands("駅弁して"));

    expect(directive).toContain("【体位指定】");
    expect(directive).toContain("駅弁");
    expect(directive).toContain("宙に浮");
    expect(directive).toContain("置き換え");
  });

  it("キャラ設定に無い枠を足さない", () => {
    const directive = POSTURE_TERMS.map((term) => buildPostureDirective([term])).join("");

    for (const framing of ["合意", "同意", "セーフワード", "境界", "配慮", "倫理"]) {
      expect(directive).not.toContain(framing);
    }
  });

  // 敵対レビュー #1236 指摘・10巡目: 単一体位向けの「この姿勢のまま...置き換えたりしない」を
  // 複数体位（転換指定）へそのまま使うと、「AからBへ変えて」という指示と文面上矛盾していた。
  it("複数体位の指定では「このまま」ではなく転換を明示する文言になる", () => {
    const directive = buildPostureDirective(detectPostureCommands("正常位から騎乗位に変えて"));

    expect(directive).toContain("転換");
    expect(directive).toContain("列挙した順に体位を移行しながら");
    expect(directive).not.toContain("この姿勢のまま描写し");
  });

  it("単一体位の指定では従来どおり「このまま」の文言になる", () => {
    const directive = buildPostureDirective(detectPostureCommands("駅弁して"));

    expect(directive).toContain("この姿勢のまま描写し");
  });

  // 敵対レビュー #1236 指摘: 実際の生成で「逃げ場が無い…もう、我慢できない」のように
  // 姿勢の力学的事実(支点・重力・接触点)を超えて、心理的な無力さ・降伏の態度として
  // <inner>へそのまま流れ込む語彙が確認された。定義文は物理的事実だけに留める。
  it("姿勢の物理的事実を超えた無力さ・降伏の語彙を含まない", () => {
    const directive = POSTURE_TERMS.map((term) => buildPostureDirective([term])).join("");

    for (const framing of ["逃げ場が", "しがみつくしかな", "自分では動けず", "我慢できない"]) {
      expect(directive).not.toContain(framing);
    }
  });
});

describe("buildPostureTableEn", () => {
  it("全ての体位を英語対応表に出す", () => {
    const table = buildPostureTableEn();

    for (const term of POSTURE_TERMS) {
      expect(table).toContain(term.label);
      expect(table).toContain(term.definitionEn);
    }
  });
});

describe("POSTURE_TERMS", () => {
  it("idが重複しない", () => {
    const ids = POSTURE_TERMS.map((term) => term.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("全ての体位が照合語を持つ", () => {
    for (const term of POSTURE_TERMS) {
      expect(term.descriptionCues.length).toBeGreaterThan(0);
    }
  });
});
