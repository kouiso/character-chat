// 性交体位の俗語 → 正規の姿勢定義。#1225/#1229。
// 「駅弁」等をモデルが別の体位や食べ物として解釈する問題を、
// 検出（表記ゆれ吸収）→ 直近注入（姿勢定義）→ 照合（descriptionCues）の3段で潰す。
// CHAT_BASE_RULES の対応表もここから生成するので、体位の定義はこのファイルが単一ソース。

export interface PostureTerm {
  id: string;
  // プロンプトの対応表に出す表記。複数の呼び名がある体位は「/」で併記する
  label: string;
  // ひらがな読みは「そくい/りつい」のように他語の一部へ紛れるものを外してある
  aliases: readonly string[];
  // CHAT_BASE_RULES（英語ブロック）用
  definitionEn: string;
  // ユーザーが実際に指定した時だけ差し込む日本語の姿勢定義。支点・重力・接触点まで書く
  definitionJa: string;
  // 応答が指定どおりの体位を描いたかの照合語。いずれか1つ出現すれば一致とみなす
  descriptionCues: readonly string[];
}

export const POSTURE_TERMS: readonly PostureTerm[] = [
  {
    id: "ekiben",
    label: "駅弁",
    aliases: ["駅弁", "えきべん", "エキベン", "駅弁位", "駅弁スタイル"],
    definitionEn:
      "the man stands and holds the woman up while penetrating; she is lifted with her legs apart, back against a wall or supported by his arms.",
    definitionJa:
      "男が立ったまま女を正面から抱え上げて挿入する。女の足は床に着かず宙に浮き、体重がそのまま結合部へ落ちる。支えは男の腕と壁だけ。揺すられるたびに自重で奥まで入る。",
    descriptionCues: [
      "抱え上げ",
      "抱えあげ",
      "抱き上げ",
      "持ち上げ",
      "担ぎ上げ",
      "宙に浮",
      "足が床",
      "脚を抱え",
      "壁に押し",
      "ぶら下が",
      "自重",
    ],
  },
  {
    id: "seijoui",
    label: "正常位",
    aliases: ["正常位", "せいじょうい", "ミッショナリー"],
    definitionEn: "missionary; the woman lies on her back and the man is on top.",
    definitionJa:
      "女が仰向けに寝て、男が上から覆いかぶさって挿入する。顔と顔が向き合い、体重が上からかかって身動きが取りにくい。",
    // 「見下ろ」「上から」は騎乗位の描写（女が上に跨がって見下ろす）にも自然に出る汎用語
    // なので落とす（敵対レビュー #1236 指摘・8巡目: 「彼女が俺に跨がり、上から見下ろし
    // ながら腰を振った」＝騎乗位の描写が「上から見下ろ」だけで正常位と誤って一致していた）。
    // 仰向け+覆いかぶさる体勢を直接示す語だけを残す。
    descriptionCues: ["仰向け", "覆いかぶさ", "押し倒", "のしかか"],
  },
  {
    id: "haigoui",
    label: "後背位 / バック",
    aliases: ["後背位", "バック"],
    definitionEn: "doggy style; the woman is on all fours or bent over, entered from behind.",
    definitionJa:
      "女が四つん這いか前かがみになり、後ろから挿入される。顔は見えず、腰だけを掴まれて引き寄せられる。",
    descriptionCues: ["後ろから", "背後", "腰を掴", "腰を引", "四つん這い", "前かがみ", "尻を"],
  },
  {
    id: "tachi-back",
    label: "立ちバック",
    aliases: ["立ちバック", "たちバック", "立ちバッグ"],
    definitionEn:
      "standing doggy style; the woman stands bent forward, braced against a wall or furniture, entered from behind.",
    definitionJa:
      "女が立ったまま前かがみになり、壁や家具に手をついて体を支え、後ろから挿入される。膝が笑って崩れそうになるのを腕だけで堪える。",
    // 「後ろから」は後背位のdescriptionCuesにもある汎用語で、四つん這い（非立位）の描写
    // だけでも一致してしまう（敵対レビュー #1236 指摘・15巡目: 「彼女は四つん這いになり、
    // 後ろから突かれた」＝後背位の描写が「後ろから」1語だけで立ちバックと誤って一致していた）。
    // 立位であることを直接示す語だけを残す。
    // 「前かがみ」も後背位のcuesと共有で、四つん這い（非立位）の描写だけでも一致する
    // （敵対レビュー #1236・18巡目: 「四つん這いになり、前かがみの姿勢で後ろから突かれた」）。
    // 立っとることを直接示す語だけを残す。
    descriptionCues: ["壁に手", "立ったまま", "膝が笑", "崩れ落ち"],
  },
  {
    id: "kijoui",
    label: "騎乗位",
    aliases: ["騎乗位", "きじょうい", "カウガール"],
    definitionEn: "cowgirl; the woman straddles the man.",
    definitionJa:
      "女が男の上に跨がり、自分の体重で深さと速さを決める。腰を落とすたびに自分で奥まで迎え入れることになる。",
    // 「腰を振」は跨がっているかどうかに関係なく、正常位を含むあらゆる体位の腰の動きに
    // 自然に出る汎用語なので落とす（敵対レビュー #1236 指摘・12巡目: 「仰向けに押し倒し、
    // 上から覆いかぶさって腰を振った」＝正常位の描写が「腰を振」1語だけで騎乗位と
    // 誤って一致してしまっていた）。跨がる体勢を直接示す語だけを残す。
    descriptionCues: ["跨が", "またが", "上に乗", "腰を落と", "見下ろ"],
  },
  {
    id: "taimen-zai",
    label: "座位 / 対面座位",
    aliases: ["対面座位", "座位"],
    definitionEn: "sitting facing each other while joined.",
    definitionJa:
      "向かい合って座ったまま繋がる。胸と胸が触れ、顔が至近距離にあって目を逸らせない。動きは浅いが密着が続く。",
    // 「密着」「抱き合」は座位・対面に限らず正常位等の全身接触でも自然に出る汎用語なので落とす
    // （敵対レビュー #1236 指摘・6巡目: 「仰向けに押し倒し、上から覆いかぶさって密着した」＝
    // 正常位の描写が「密着」1語だけで対面座位と誤って一致してしまっていた）。
    // 「目が合」も正常位の覆いかぶさる描写に自然に出る汎用語なので同様に落とす
    // （敵対レビュー #1236 指摘・11巡目: 「仰向けに押し倒し、上から覆いかぶさると目が合った」＝
    // 正常位の描写が「目が合」1語だけで対面座位と誤って一致してしまっていた）。
    // 座って向かい合う体勢を直接示す語だけを残す。
    descriptionCues: ["向かい合", "膝の上", "座ったまま"],
  },
  {
    id: "haimen-zai",
    label: "背面座位",
    aliases: ["背面座位", "背面騎乗", "リバースカウガール"],
    definitionEn: "reverse cowgirl sitting; the woman's back faces the man.",
    definitionJa:
      "女が背を向けて座り、後ろから抱えられたまま繋がる。首筋と背中が男に晒され、表情だけが隠れる。",
    // 「背中」単独は正常位の描写にも自然に出る汎用語なので落とす
    // （敵対レビュー #1236 指摘: 「背中を撫でながら、仰向けのまま覆いかぶさった」で誤検出）。
    // 「首筋」「うなじ」も同様に落とす。正常位でも身をかがめて首筋にキスする描写は自然に
    // 出るため、背面座位固有の証拠にならない（敵対レビュー #1236 指摘・3巡目:
    // 「彼女を仰向けにして上から覆いかぶさり、首筋へ口づけた」で誤検出）。
    descriptionCues: ["背を向け", "後ろから抱"],
  },
  {
    id: "sokui",
    label: "側位",
    aliases: ["側位", "スプーン"],
    definitionEn: "spooning / side-entry; both lie on their sides.",
    definitionJa:
      "二人とも横向きに寝たまま、後ろまたは横から繋がる。動きは浅いが体の面が触れ合ったまま長く続く。",
    // 「寝たまま」「抱き寄せ」「耳元」は横向きに限らず正常位・後背位等でも自然に出る汎用語
    // なので落とす（敵対レビュー #1236 指摘・5巡目:
    // 「彼女を仰向けに寝かせたまま、強く抱き寄せた」＝正常位の描写が「抱き寄せ」1語だけで
    // 側位と誤って一致してしまっていた）。横向きの体勢を直接示す語だけを残す。
    descriptionCues: ["横向き", "背中を預け"],
  },
  {
    id: "matsuba",
    label: "松葉崩し",
    aliases: ["松葉崩し", "まつばくずし"],
    definitionEn:
      "the woman lies on her side with one leg raised while the man kneels astride her lower leg.",
    definitionJa:
      "女が横向きに寝て片脚を上げ、男がその脚をまたぐように膝立ちで繋がる。角度が変わって普段と違う場所に当たる。",
    // 「角度」は正常位の描写にも自然に出る汎用語、「横向き」は側位と共有（敵対レビュー・18巡目:
    // 「仰向けに押し倒し、角度を変えて上から覆いかぶさった」が「角度」1語で一致していた）。
    // 片脚を上げた横臥という固有姿勢を直接示す語だけを残す。
    descriptionCues: ["片脚", "片足", "脚を上げ", "膝立ち"],
  },
  {
    id: "ritsui",
    label: "立位",
    aliases: ["立位"],
    definitionEn: "standing intercourse.",
    definitionJa: "二人とも立ったまま繋がる。膝が震え、体を相手に預けて支える。",
    // 「膝」「壁」は単独の1文字で無関係な文脈にも出るため落とす（敵対レビュー #1236 指摘）
    descriptionCues: ["立ったまま", "しがみつ", "つま先"],
  },
  {
    id: "kakae",
    label: "抱え / 担ぎ / 抱っこ",
    aliases: ["お姫様抱っこ", "抱っこ", "抱え上げ", "担ぎ"],
    definitionEn: "the man lifts and carries the woman while penetrating.",
    definitionJa:
      "男が女を抱き上げ、運びながら繋がる。足が床に着かず、歩くたび揺れるたびに深く入る。",
    // 「揺れ」はベッドや車の揺れにも出る汎用語で、抱え上げの証拠にならん（敵対レビュー・18巡目:
    // 「仰向けに押し倒し、激しく動くたびベッドが揺れた」が「揺れ」1語で一致していた）。
    descriptionCues: ["抱き上げ", "抱え上げ", "運ば", "宙に", "足が着か"],
  },
  {
    id: "yotsunbai",
    label: "四つん這い",
    aliases: ["四つん這い", "四つ這い", "よつんばい"],
    definitionEn: "the woman is on all fours.",
    definitionJa:
      "女が両手両膝を床につき、腰だけを高く上げた姿勢を取る。腕で体を支えたまま揺さぶられる。",
    // 「腕が」は支える腕の言及だけで四つん這い以外の体勢（例: 仰向けで押し倒され、支える腕が
    // 震えた）にも自然に出る汎用語なので落とす（敵対レビュー #1236 指摘・10巡目）。
    // 四つん這い固有の姿勢を直接示す語だけを残す。
    descriptionCues: ["四つん這い", "手をつ", "膝をつ", "腰を上げ"],
  },
] as const;

// CHAT_BASE_RULES の英語対応表。POSTURE_TERMS から生成して二重管理を避ける
export const buildPostureTableEn = (): string =>
  POSTURE_TERMS.map((term) => `  * ${term.label} = ${term.definitionEn}`).join("\n");

const KATAKANA_RUN = /[ァ-ヺー]/;
const isKatakanaOnly = (value: string): boolean =>
  value.split("").every((char) => KATAKANA_RUN.test(char));

// カタカナ語の別名は前後もカタカナだと別の単語の一部（バックアップ等）なので弾く
const isStandaloneMatch = (text: string, alias: string, index: number): boolean => {
  if (!isKatakanaOnly(alias)) return true;
  const before = text[index - 1];
  const after = text[index + alias.length];
  return !(before && KATAKANA_RUN.test(before)) && !(after && KATAKANA_RUN.test(after));
};

type AliasHit = { term: PostureTerm; start: number; end: number };

// 「正常位じゃなくて騎乗位にして」のような打ち消しは、直後にこの語が続く形で書かれる。
// 否定された側を候補から外さんと、指定してへん体位まで【体位指定】へ並んでしまう
// （敵対レビュー #1236 指摘）。「〜から〜に変えて」のような体位転換の複数指定はこの並びに
// 一致せんので、既存の「出現順で複数返す」挙動はそのまま残る。
const NEGATION_MARKERS = [
  "じゃなくて",
  "じゃなく",
  "じゃない",
  "ではなくて",
  "ではなく",
  "ではない",
  "でなくて",
  "でなく",
  // 「正常位はやめて」「正常位以外で」等（敵対レビュー #1236 指摘）
  "はやめて",
  "はやめ",
  "はいや",
  // 「正常位は嫌だから」のような漢字表記の拒否は「はいや」（ひらがな）に一致せんため
  // 別途拾う必要がある（敵対レビュー #1236 指摘・14巡目）。
  "は嫌",
  "はダメ",
  "はなし",
  "はナシ",
  // 「正常位は無理」「正常位は結構です」「正常位はちょっと」のような婉曲な拒否も、
  // 「はいや」「は嫌」と同じく直後にこの体位を否定している（敵対レビュー #1236
  // 指摘・15巡目自己レビュー）。
  "は無理",
  "は結構",
  "はちょっと",
  // 助詞が「が」の形とカタカナ表記も同じ拒否（敵対レビュー #1236・18巡目）。
  "が嫌",
  "がいや",
  "がイヤ",
  "はイヤ",
  "が無理",
  // 「駅弁なしで、正常位にして」のように「は」を伴わず体位名に直接続く打ち消しも同様
  // （敵対レビュー #1236 指摘・15巡目自己レビュー）。
  "なしで",
  "以外で",
  "以外に",
  "以外は",
  "以外の",
  // 「正常位以外がいい」（敵対レビュー #1236・18巡目）
  "以外が",
  // 「正常位にしないで騎乗位にして」「正常位にしてほしくない」のように、体位名の直後に
  // 動詞化した打ち消しが続く形（敵対レビュー #1236 指摘・4巡目）。
  // collectAliasOccurrences を共有する hasExplicitPostureCommand 側もここで一緒に否定除外される。
  "にしないでほしい",
  "にしてほしくない",
  "にしたくない",
  "にしないで",
  // 「正常位より騎乗位にして」「正常位よりも騎乗位がいい」のような比較による置き換えも、
  // 左側の体位が拒否されとる（敵対レビュー #1236 指摘・8巡目）。「より」は「よりも」の
  // 接頭辞なので両方をこの1語でカバーする。
  "より",
] as const;

const isNegatedMatch = (text: string, end: number): boolean =>
  NEGATION_MARKERS.some((marker) => text.startsWith(marker, end));

// 「正常位ってどういう体位？」「正常位の説明をして」のように、体位名の直後に
// 質問・説明要求の語が続く形は、実行してほしい命令やのうて意味を尋ねとるだけ
// （敵対レビュー #1236 指摘・5巡目）。この場合まで【体位指定】を差し込んで実演を
// 強制すると、質問への説明的な回答が posture-mismatch で毎回弾かれてしまう。
// 「って」単独は「〜がしたい」等の口語フィラーとしても使われ、命令表現の一部にも
// 紛れ込むため対象にしん。疑問形と組み合わさった具体的な語形だけを見る。
const QUESTION_OR_EXPLANATION_MARKERS = [
  "って何",
  "ってなに",
  "ってどういう",
  "ってどんな",
  "とは",
  "はどういう",
  "はどんな",
  "の説明",
  "を説明",
  "について",
] as const;

const isQuestionOrExplanationMatch = (text: string, end: number): boolean =>
  QUESTION_OR_EXPLANATION_MARKERS.some((marker) => text.startsWith(marker, end));

// 「正常位と騎乗位、どっちが好き？」のように、体位名の直後ではなく文末で問う比較質問は
// isQuestionOrExplanationMatch（別名の直後だけを見る）では拾えない（敵対レビュー #1236
// 指摘・5巡目）。この形は片方だけでなく両方の候補が質問の対象なので、別名ごとの除外やのうて
// 文全体をコマンドとして扱わないほうへ倒す。
const PREFERENCE_QUESTION_PATTERN =
  /(?:どっち|どちら)(?:が|の方が|のほうが)?.{0,6}(?:好き|いい|良い|得意|苦手)/u;

const isPreferenceComparisonQuestion = (text: string): boolean =>
  PREFERENCE_QUESTION_PATTERN.test(text);

// 「正常位または騎乗位のどちらかにして」のような選択指定は、片方だけを選んで実演すればよい
// のに、複数体位検出をそのまま「両方とも必須」として扱ってしまうと、checkPostureMatchが
// 選ばれなかった側の証拠も要求してしまう（敵対レビュー #1236 指摘・6巡目）。「または/もしくは」
// +「どちらか/どっちか」は、指定順どおりの転換（「AからBに」）とは違い片方選択の意味なので、
// PREFERENCE_QUESTION_PATTERNと同じく文全体を検出対象から外す。
// 「AとBのどちらかにして」「AでもBでもいい」「A、B、どちらか選んで」も片方選択。
// 「または/もしくは」+「どちらか」の形しか見ておらず、日本語として最も自然な
// 「と…のどちらか」を取りこぼしていた（敵対レビュー #1236・18巡目）。
const ALTERNATIVE_SELECTION_PATTERN =
  /(?:または|もしくは|と|、).{0,12}(?:どちらか|どっちか)|でも.{0,12}でも(?:いい|よい|OK)/u;

const isAlternativeSelection = (text: string): boolean => ALTERNATIVE_SELECTION_PATTERN.test(text);

// 「正常位か騎乗位にして」のように「または/もしくは」+「どちらか/どっちか」の定型句を
// 伴わない、単独の「か」だけで並ぶ選択も片方選択の意味（敵対レビュー #1236 指摘・11巡目）。
// 「から」（2文字の転換を表す助詞）との違いを、隣接する体位名の間が「か」1文字だけかどうかで
// 見分ける。「正常位から騎乗位に」は間が「から」（2文字）なので対象外のまま。
// 「正常位または騎乗位にして」「正常位あるいは騎乗位にして」のように「どちらか/どっちか」の
// 選択サフィックスを伴わない「または/もしくは/あるいは」も、体位名の間に直接挟まる形なら
// 同じく片方選択の意味（敵対レビュー #1236 指摘・14巡目: ALTERNATIVE_SELECTION_PATTERNが
// どちらか/どっちかの併記を必須にしていたため、この定型句が無いと転換の複数指定として
// 誤って両方必須にしてしまっていた）。
const ADJACENT_ALTERNATIVE_CONJUNCTIONS = ["か", "または", "もしくは", "あるいは"] as const;

// 「正常位か、騎乗位にして」「正常位、または騎乗位にして」のように読点を挟んだ自然な
// 書き方は、between文字列が完全一致にならず素通りしていた（敵対レビュー #1236
// 指摘・15巡目自己レビュー）。読点は選択の意味を変えんので比較前に除去する。
const stripAdjacentCommas = (value: string): string => value.replace(/、/gu, "");

const hasAdjacentAlternativeConjunction = (sentence: string, hits: AliasHit[]): boolean => {
  const sorted = [...hits].sort((left, right) => left.start - right.start);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const between = stripAdjacentCommas(sentence.slice(sorted[i].end, sorted[i + 1].start));
    if (
      ADJACENT_ALTERNATIVE_CONJUNCTIONS.includes(
        between as (typeof ADJACENT_ALTERNATIVE_CONJUNCTIONS)[number],
      )
    )
      return true;
  }
  return false;
};

// 「正常位か騎乗位、どっちも味わいたい」のように「か」で並べつつ文中に明示的な
// 「両方とも」の要求（どっちも/両方）が出る文は、片方選択やのうて両方の実演を
// 求めとる（敵対レビュー #1236 指摘・15巡目自己レビュー）。この場合は選択扱いにせず、
// 通常の複数指定（両方必須）へ倒す。
const BOTH_REQUIRED_PATTERN = /どっちも|両方/u;

const hasExplicitBothRequirement = (sentence: string): boolean =>
  BOTH_REQUIRED_PATTERN.test(sentence);

const collectAliasOccurrences = (text: string, term: PostureTerm, alias: string): AliasHit[] => {
  const hits: AliasHit[] = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(alias, from);
    if (index === -1) break;
    const end = index + alias.length;
    if (
      isStandaloneMatch(text, alias, index) &&
      !isNegatedMatch(text, end) &&
      !isQuestionOrExplanationMatch(text, end)
    ) {
      hits.push({ term, start: index, end });
    }
    from = index + 1;
  }
  return hits;
};

// isQuestionOrExplanationMatchを通さない、位置検出だけの出現一覧。「正常位か騎乗位って
// どういう体位？」のような疑問文は、質問マーカーがペアの後ろ側（騎乗位）の直後にしか
// 来ないため、alias単位で質問マーカーを見るcollectAliasOccurrencesだと前側（正常位）が
// 質問扱いされず残ってしまう（敵対レビュー #1236 指摘・13巡目）。ペア全体が疑問文の
// 対象かどうかを判定するには、質問マーカーで先に間引く前の生の位置情報が要る。
const collectRawAliasOccurrences = (text: string, term: PostureTerm, alias: string): AliasHit[] => {
  const hits: AliasHit[] = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(alias, from);
    if (index === -1) break;
    const end = index + alias.length;
    if (isStandaloneMatch(text, alias, index)) {
      hits.push({ term, start: index, end });
    }
    from = index + 1;
  }
  return hits;
};

// 文中のどこかに疑問・説明要求のマーカーがあり、かつ体位名が「か」で隣接しとる時は、
// ペア全体へまとめて意味を問う疑問文とみなし、文全体を対象外にする。
const hasAlternativeExplanationQuestion = (sentence: string, rawHits: AliasHit[]): boolean =>
  QUESTION_OR_EXPLANATION_MARKERS.some((marker) => sentence.includes(marker)) &&
  hasAdjacentAlternativeConjunction(sentence, rawHits);

// 文末の句点・感嘆符・疑問符で区切る（区切り記号は直前の文へ残す）。「正常位にして。
// 飲み物は水またはお茶のどちらかで」のように、無関係な比較質問・選択指定が別の文に
// あるだけで、同じメッセージ内の明示コマンド（「正常位にして」）まで巻き添えで
// 検出対象から外してしまっていた（敵対レビュー #1236 指摘・7巡目）。比較質問・選択指定の
// 判定は、それを含む文の範囲だけに絞る。「正常位と騎乗位、どっちが好き？」のように
// 読点でしか区切られとらん比較質問は、同じ文のまま両方とも対象外になる（従来どおり）。
const SENTENCE_SPLIT_PATTERN = /(?<=[。！？])/u;

// 長い別名を優先し、位置が重なる短い別名を捨てる（「立ちバック」に含まれる「バック」、
// 「背面座位」に含まれる「座位」等）。detectPostureCommands と detectAlternativePostures の
// 両方で要る（敵対レビュー #1236・18巡目: 選択指定側だけ通してへんかった）。
const resolveOverlappingHits = (hits: AliasHit[]): AliasHit[] => {
  const byLengthDesc = [...hits].sort(
    (left, right) => right.end - right.start - (left.end - left.start) || left.start - right.start,
  );
  const claimed: AliasHit[] = [];
  for (const hit of byLengthDesc) {
    if (!claimed.some((kept) => hit.start < kept.end && kept.start < hit.end)) claimed.push(hit);
  }
  return claimed;
};

const collectSentenceAliasHits = (sentence: string): AliasHit[] => {
  const bothRequired = hasExplicitBothRequirement(sentence);
  if (isPreferenceComparisonQuestion(sentence)) {
    // 命令形の体位だけを残す。文単位の真偽で判定すると、命令が1つあるだけで
    // 質問側に並んだ体位まで巻き添えで残った（敵対レビュー・18巡目:
    // 「正常位にして、騎乗位と駅弁どっちが好き？」が3体位とも命令扱いになっていた）。
    const commandedHits = POSTURE_TERMS.flatMap((term) =>
      term.aliases.flatMap((alias) =>
        collectAliasOccurrences(sentence, term, alias).filter((hit) =>
          /^(して|にして|でして)/u.test(sentence.slice(hit.end)),
        ),
      ),
    );
    return resolveOverlappingHits(commandedHits).sort((left, right) => left.start - right.start);
  }
  if (isAlternativeSelection(sentence) && !bothRequired) return [];
  const rawHits = POSTURE_TERMS.flatMap((term) =>
    term.aliases.flatMap((alias) => collectRawAliasOccurrences(sentence, term, alias)),
  );
  if (hasAlternativeExplanationQuestion(sentence, rawHits)) return [];
  const hits = POSTURE_TERMS.flatMap((term) =>
    term.aliases.flatMap((alias) => collectAliasOccurrences(sentence, term, alias)),
  );
  if (hasAdjacentAlternativeConjunction(sentence, hits) && !bothRequired) return [];
  return hits;
};

// 「AかB」「AまたはBのどちらか」の選択指定に含まれる体位を、転換の順序やのうて
// 集合として返す。detectPostureCommandsはこの手の選択指定を検出対象から外す
// （片方だけ実演すればよく、両方の実演を強制するのは誤り）が、その結果「いずれも
// 実演しない」応答まで無条件に通してしまう（敵対レビュー #1236 指摘・12巡目）。
// この集合を使って「いずれか1つ」の緩い要件として別途検証できるようにする。
export const detectAlternativePostures = (text: string): PostureTerm[] => {
  if (!text) return [];
  return text.split(SENTENCE_SPLIT_PATTERN).flatMap((sentence) => {
    if (isPreferenceComparisonQuestion(sentence)) return [];
    const hits = POSTURE_TERMS.flatMap((term) =>
      term.aliases.flatMap((alias) => collectAliasOccurrences(sentence, term, alias)),
    );
    const isAlternative =
      (isAlternativeSelection(sentence) || hasAdjacentAlternativeConjunction(sentence, hits)) &&
      !hasExplicitBothRequirement(sentence);
    if (!isAlternative) {
      return [];
    }
    // detectPostureCommands と同じ重なり解決を通す。「背面座位か正常位にして」は
    // 「背面座位」の中の「座位」も別名として一致するため、そのままやと対面座位まで
    // 候補へ入り、対面座位だけ描いた応答が checkPostureAlternativeMatch を通ってしまう
    // （敵対レビュー #1236・18巡目）。長い別名を優先して短い重なりを捨てる。
    const seen = new Set<string>();
    return resolveOverlappingHits(hits)
      .sort((left, right) => left.start - right.start)
      .filter((hit) => {
        if (seen.has(hit.term.id)) return false;
        seen.add(hit.term.id);
        return true;
      })
      .map((hit) => hit.term);
  });
};

const collectAliasHits = (text: string): AliasHit[] => {
  let offset = 0;
  return text.split(SENTENCE_SPLIT_PATTERN).flatMap((sentence) => {
    const hits = collectSentenceAliasHits(sentence).map((hit) => ({
      term: hit.term,
      start: hit.start + offset,
      end: hit.end + offset,
    }));
    offset += sentence.length;
    return hits;
  });
};

/**
 * ユーザー入力から指定された体位を検出する。
 * 「立ちバック」に含まれる「バック」のような部分一致は、長い別名を優先して落とす。
 *
 * 既知の制約: 非カタカナの別名（駅弁等）は語義判定をせん単純な部分一致なので、
 * 「駅弁を買った」のような無関係な文脈でも誤検出しうる。呼び出し側
 * （route-context.ts の buildServerQualityContext）が erotic/climax フェーズ、または
 * hasExplicitPostureCommand が真の時だけに検出を絞っとるため、実害はその範囲での
 * 取り違えに限られる。
 * 「〜じゃなくて」等の直後に続く打ち消しは除外するが、それ以外の否定表現
 * （離れた位置の「〜はやめて」等）までは拾わない。
 */
export const detectPostureCommands = (text: string): PostureTerm[] => {
  if (!text) return [];
  const ordered = resolveOverlappingHits(collectAliasHits(text)).sort(
    (left, right) => left.start - right.start,
  );
  // 「駅弁、駅弁でして」のような単なる強調の連呼は1件にまとめたいが、「正常位から騎乗位、
  // 最後に正常位に戻して」のように間に別の体位を挟んで巻き戻る転換は、checkPostureMatch が
  // 巻き戻り後の描写まで要求できるよう別ステップとして残す必要がある（敵対レビュー #1236
  // 指摘・9巡目: id単位で一律dedupeしとったため、巻き戻し後のAが消えてBで止まった応答まで
  // 通ってしまっていた）。直前と同じidが連続する時だけ重複として畳む。
  const result: PostureTerm[] = [];
  for (const hit of ordered) {
    if (result[result.length - 1]?.id === hit.term.id) continue;
    result.push(hit.term);
  }
  return result;
};

// 体位名の直後に「して/にして/でして」が続く形。曖昧語（駅弁=弁当、スプーン=食器等）を
// 含んでいても、コマンド動詞が直接続く並びは日常語との衝突が少ない。
const EXPLICIT_COMMAND_SUFFIX = /^(して|にして|でして)/;

// この2語は「+して」の形そのものが体位と無関係な日常語として極めて一般的なため、
// フェーズゲートを緩める対象から外す（敵対レビュー #1236 のセルフレビューで発見）。
// 「バックして」= 車やゲームで「後退して」の意味で使われる方が普通。
// 「抱っこして」= 子供や恋人への「抱きしめて/持ち上げて」という non-sexual な甘え表現。
// erotic/climax フェーズ内での detectPostureCommands 自体はこの制限の影響を受けない。
const AMBIGUOUS_OUTSIDE_EROTIC_CONTEXT_IDS = new Set(["haigoui", "kakae"]);

/**
 * シーンフェーズがまだ erotic/climax に達していないターンでも、体位名へ直接コマンド接尾辞
 * （して/にして/でして）が続く形なら明示的な指示とみなしてよい。
 * 敵対レビュー #1236: 「えきべんして」「ミッショナリーでして」「スプーンでして」
 * 「松葉崩しにして」が、他の erotic 語を伴わない単発発話だと scene-phase 側の
 * フェーズ判定が conversation のまま止まり、requestedPostures が undefined になって
 * 体位指定ごと無視されていた。フェーズ判定そのものは変えず、体位検出の実行条件だけを
 * この関数で緩める。ただし AMBIGUOUS_OUTSIDE_EROTIC_CONTEXT_IDS の語は除外する。
 */
export const hasExplicitPostureCommand = (text: string): boolean => {
  if (!text) return false;
  return collectAliasHits(text).some(
    (hit) =>
      !AMBIGUOUS_OUTSIDE_EROTIC_CONTEXT_IDS.has(hit.term.id) &&
      EXPLICIT_COMMAND_SUFFIX.test(text.slice(hit.end)),
  );
};

/**
 * 指定された体位を直近ターンへ差し込むための指示ブロック。
 * 姿勢の定義だけを渡し、態度や力関係は書かない（no-injected-ai-filter）。
 */
export const buildPostureDirective = (postures: readonly PostureTerm[]): string => {
  if (postures.length === 0) return "";
  const lines = postures.map((term) => `・${term.label}: ${term.definitionJa}`).join("\n");
  // 「この姿勢のまま描写し...置き換えたりしない」は単一体位向けの文言で、複数体位（転換指定）
  // へそのまま使うと「AからBへ変えて」の指示と矛盾する（敵対レビュー #1236 指摘・10巡目:
  // 転換を求めているのに「今の姿勢のまま」「置き換えない」と読めてしまい、最初の体位で
  // 止まる・片方しか描写しない応答を誘発しうる）。複数指定時は列挙順の転換を明示する。
  const instruction =
    postures.length > 1
      ? "ユーザーが今のターンで次の体位への転換を指定した。列挙した順に体位を移行しながら描写し、途中で止めたり指定していない体位・場所へ置き換えたりしない。"
      : "ユーザーが今のターンで次の体位を指定した。この姿勢のまま描写し、別の体位・別の場所へ置き換えたり無視したりしない。";
  return `\n【体位指定】${instruction}姿勢そのもの（支え・重心・どこが触れているか）が分かる描写を本文に入れること。\n${lines}`;
};
