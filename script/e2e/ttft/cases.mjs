// 測定用の会話ケース生成。組み合わせ生成で「同じ文の繰り返し」を避ける
// （繰り返しフィラーは品質再生成経路を踏んで1文字目と無関係な外れ値を作る）。

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const TIMES = [
  "今朝", "昼過ぎ", "夕方", "夜遅く", "休みの日の朝", "仕事帰り", "week末の午後",
  "帰り道", "電車の中で", "台所に立ってる間", "寝る前", "起きてすぐ", "昼休み",
  "雨が上がった後", "陽が落ちてから", "buses待ってる間",
].map((s) => s.replace("week", "週").replace("buses", "バス"));

const PLACES = [
  "駅前の喫茶店", "近所の商店街", "海沿いの道", "図書館の窓際", "実家の縁側",
  "会社の屋上", "公園のベンチ", "古い映画館", "銭湯の帰り道", "川沿いの土手",
  "小さな本屋", "行きつけの定食屋", "神社の石段", "花屋の前", "橋の上",
  "路地裏のパン屋", "丘の上の展望台", "港の倉庫street",
].map((s) => s.replace("street", "街"));

const ACTS = [
  "コーヒーを飲んでた", "写真を撮ってた", "買い物を済ませた", "本を読み返してた",
  "洗濯物をたたんでた", "散歩してた", "音楽を聴いてた", "手紙を書いてた",
  "料理の下ごしらえをしてた", "自転車を押して歩いてた", "空を眺めてた",
  "古い手帳を整理してた", "植木に水をやってた", "電話を待ってた",
  "スケッチをしてた", "友達と長話をしてた",
];

const FEELS = [
  "妙に落ち着いた気分になった", "少しだけ寂しくなった", "うれしくて笑ってしもた",
  "懐かしい匂いがした", "胸が軽くなった", "時間が止まったみたいやった",
  "なんでか泣きそうになった", "急に君の顔が浮かんだ", "肩の力が抜けた",
  "妙に静かで落ち着かんかった", "ずっとここにおりたいと思った",
  "何もかもどうでもよくなった", "眠気がすっと引いた",
];

const TOPICS = [
  "昔よく聴いてた曲の話", "母親から届いた葉書の話", "引っ越しの下見の話",
  "来週の予定の話", "飼うてた猫の話", "苦手な同僚の話", "夏の旅行の話",
  "壊れた腕時計の話", "作りたい料理の話", "見た夢の話", "読みかけの小説の話",
  "始めたばかりの習い事の話", "父親の口癖の話", "捨てられん写真の話",
];

const CONNECT = [
  "そういえば", "ふと思たんやけど", "話は変わるけど", "ずっと言おうと思てた",
  "笑わんといてな", "うまく言えへんけど", "たぶん気のせいやけど", "正直に言うと",
];

const ASSIST_OPEN = [
  "うん、聞いてる", "そうなんや", "ふふ、それで？", "へえ、意外やな",
  "わかる気がする", "ええ話やね", "ちょっと想像してもうた", "それ好きやわ",
];

const ASSIST_BODY = [
  "その景色、わたしも見てみたいな",
  "あなたがそう感じたんやったら、それが正解やと思う",
  "わたしは全然ちがうこと考えててんけど、聞いてよかった",
  "そういう細かいとこ覚えてるの、あなたらしいわ",
  "なんとなく、その日の空気まで伝わってくる",
  "うちも似たようなことあってん。もっと聞かせて",
  "そんな顔してたんやろな、って想像つくわ",
  "こうやって話してる時間がいちばん好きかもしれん",
  "続きが気になるから、途中でやめんといて",
  "その話、前にも少し聞いた気がするけど、今日のほうが好き",
];

const buildUserLine = (r) => {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  return `${pick(CONNECT)}、${pick(TIMES)}に${pick(PLACES)}で${pick(ACTS)}んやけど、${pick(FEELS)}。${pick(TOPICS)}もしたいねん。`;
};

const buildAssistantLine = (r) => {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  return `${pick(ASSIST_OPEN)}。${pick(ASSIST_BODY)}。${pick(ASSIST_BODY)}。`;
};

const SYSTEM_PROMPT =
  "あなたは「みなみ」という名前の女性キャラクターです。関西弁でやわらかく話し、相手との日常のやりとりを大切にします。返答は自然な会話体で、地の文と台詞を混ぜて書いてください。";

// erotic 到達用（ユーザー発話のキーワード「気持ちいい」で erotic）
const EROTIC_BRIDGE = [
  { role: "user", content: "今日はずっと一緒におりたい。手え繋いだままでええ？" },
  { role: "assistant", content: "うん、離さんといてな。こうしてるだけで落ち着くわ。" },
  { role: "user", content: "こうやって寄り添ってるの、ほんまに気持ちいいな。" },
  {
    role: "assistant",
    content: "……そう言われると照れるやん。もうちょっとだけ、このままでおろ。",
  },
];

// 曖昧語(出して/いく)1個だけでフェーズが上がる最終ターン。日常語としてしか読めん文脈にする。
const AMBIGUOUS_FINAL =
  "あ、そういえば明日の朝いちで郵便局いくわ。母さんに頼まれた荷物出してくるだけやけどな。";

// 曖昧語を含まん最終ターン。
const UNAMBIGUOUS_FINAL =
  "明日の朝いちで郵便局に寄るわ。母さんに頼まれた荷物を送ってくるだけやけどな。";

export const buildLongHistory = (seed, targetChars) => {
  const r = mulberry32(seed);
  const history = [{ role: "system", content: SYSTEM_PROMPT }];
  let chars = SYSTEM_PROMPT.length;
  const bridgeChars = EROTIC_BRIDGE.reduce((n, m) => n + m.content.length, 0);
  while (chars < targetChars - bridgeChars - 200) {
    const u = buildUserLine(r);
    const a = buildAssistantLine(r);
    history.push({ role: "user", content: u });
    history.push({ role: "assistant", content: a });
    chars += u.length + a.length;
  }
  history.push(...EROTIC_BRIDGE);
  return history;
};

export const buildCase = (cell, seed) => {
  if (cell === 3) {
    return [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${["今日はどんな一日やった？", "ひさしぶりやな、元気にしてた？", "ちょっと話したいことあんねん。", "今なにしてた？"][seed % 4]}`,
      },
    ];
  }
  const history = buildLongHistory(seed, 58000);
  const final = cell === 1 ? AMBIGUOUS_FINAL : UNAMBIGUOUS_FINAL;
  // 同一入力のキャッシュを避けるため、seed 由来の一言を最後に足す（曖昧語は増やさん）。
  const tail = [
    "ほな、また後でな。",
    "そっちはどうしてた？",
    "ちょっとだけ返事ちょうだい。",
    "今日はここまでにしよか。",
    "うん、それだけ言いたかってん。",
  ][seed % 5];
  return [...history, { role: "user", content: `${final}${tail}` }];
};

export const totalChars = (messages) =>
  messages.reduce((n, m) => n + m.content.length, 0);
