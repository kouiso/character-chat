// 反応言い換え連投: 同一部位×同一反応クラスの言い換えが同じターン内で3回以上続く症状を
// 検出する（within-turn-repetition のJaccard/部分文字列一致では拾えん同義語言い換え）。
//
// 対象範囲の線引き（stem-repetition-check.ts と対で読むこと。refute-filter 2026-09-13
// carry-forward 4 で「どっちかに揃えろ」と指摘された点を、揃えずに分けると決めた理由）:
// こっちは <dialogue> を見ん。3回で落とす閾値は地の文の言い換え連投を想定した狭さで、
// 台詞は喘ぎ・呼びかけの反復がキャラの表現として正当に出る場所やから、同じ閾値を当てると
// 設定どおりの台詞を落としてまう（prompt/instructions/no-injected-ai-filter.md）。
// この線引きはテスト「<dialogue>の言い回しは対象外」で固定しとる。
// 台詞込みで数えるべき「語幹の叩きすぎ」は stem-repetition-check が閾値5/4で見とる。

// 長い語を先に置く（「内腿」「太もも」が「腿」「奥」で先に食われんように）。
// 「腰」だけは家具の「腰掛け」を身体部位と誤認する実例があるため除外する。
// refute-evasion 2026-09-13 #5: 指先・膝・肩のように性器から離れた部位が表に無く、
// そこで連投されると1回も数えられんかった。部位の列挙は「どこを数えるか」の表であって
// 禁止語やないので、汎用部位まで広げる。
const BODY_PART_PATTERN =
  /内腿|太もも|太腿|腿|内股|子宮の入り口|子宮の奥|子宮の中|子宮口|子宮|膣の襞|膣の奥|膣内|膣|秘部|花芯|陰核|クリトリス|お腹の奥|お腹の中|下腹|お腹|乳首|乳房|胸元|胸|首筋|うなじ|耳|唇|舌|喉|頬|瞼|目頭|背中|背筋|肩(?!書)|二の腕|腕|指先|指(?![示定摘揮針すし])|膝|お尻|尻|つま先|足先|脇腹|脇|腰(?!掛)|結合部|奥/gu;

// 同じ場所の言い換え（内腿／太もも／腿、胸／乳房／胸元）は1つの部位へ寄せる。
// refute-r2 2026-09-14 #5: 同じ場所を呼び替えながら反復すると、部位ごとに別カウンタへ
// 散って閾値に届かんかった。呼び替えの連投こそがこの check の見とる症状やから、
// 「どこを指しとるか」で数える。
// 体の内側を指す語は全部「内側」の1カウンタへ寄せる。絶頂の場面で一番出る家族で、
// 子宮口→膣の襞→お腹の奥→子宮の奥 と呼び替えながら4回書いても、部位ごとに散って
// 閾値3に届かんかった（refute-r3 2026-09-14 #3、実測 phase39#9 Sakura）。
// 外から触れる場所（陰核）は別の場所なので寄せん。
const CANONICAL_BODY_PART: Record<string, string> = {
  内腿: "腿",
  太もも: "腿",
  太腿: "腿",
  内股: "腿",
  奥: "内側",
  子宮: "内側",
  子宮口: "内側",
  子宮の入り口: "内側",
  子宮の奥: "内側",
  子宮の中: "内側",
  膣: "内側",
  膣内: "内側",
  膣の襞: "内側",
  膣の奥: "内側",
  秘部: "内側",
  花芯: "内側",
  結合部: "内側",
  お腹の奥: "内側",
  お腹の中: "内側",
  クリトリス: "陰核",
  下腹: "お腹",
  乳房: "胸",
  胸元: "胸",
  うなじ: "首筋",
  二の腕: "腕",
  指: "指先",
  お尻: "尻",
  足先: "つま先",
  脇腹: "脇",
};

const canonicalBodyPart = (bodyPart: string): string => CANONICAL_BODY_PART[bodyPart] ?? bodyPart;

const REACTION_CLASS_PATTERNS: Record<string, RegExp> = {
  濡れる系: /濡れ|潤|滲|湿|溢れ|愛液|蜜|とろ|ぬる|びっしょり|染み/u,
  締まる系: /締|キュン|きゅっ|痙攣|うねり|収縮/u,
  震える系: /震え|ふるえ|びくん|びくっ|痺れ|ぴりっ/u,
  熱系: /熱|火照|熱く|灼け/u,
};

const REPETITION_THRESHOLD = 3;

const ACTION_BLOCK_PATTERN = /<action>([\s\S]*?)<\/action>/gu;
const INNER_BLOCK_PATTERN = /<inner>([\s\S]*?)<\/inner>/gu;

const extractAllTagBlocks = (response: string, pattern: RegExp): string =>
  [...response.matchAll(pattern)].map((match) => match[1]).join("\n");

const TAG_PATTERN = /<[^>]+>/gu;

const DIALOGUE_BLOCK_PATTERN = /<dialogue>[\s\S]*?<\/dialogue>/gu;
const QUOTED_SPEECH_PATTERN = /「[^」]*」/gu;

// <dialogue> は台詞なので除外し、地の文（<action>）と内心（<inner>）だけを対象にする。
// タグを持たん素のテキストでは鉤括弧の中を台詞とみなして外す。全文を地の文として読むと、
// タグが無いだけで「台詞は対象外」の線引きがひっくり返っとった（refute-r2 2026-09-14 #5）。
// forbidden-word-check.ts は台詞が対象内なので、同じ入力でも扱いが反対になるのが正しい。
const extractNarration = (response: string): string => {
  const hasTags = /<action>|<inner>/u.test(response);
  if (!hasTags) {
    return response
      .replace(DIALOGUE_BLOCK_PATTERN, "")
      .replace(QUOTED_SPEECH_PATTERN, "")
      .replace(TAG_PATTERN, "");
  }
  return [
    extractAllTagBlocks(response, ACTION_BLOCK_PATTERN),
    extractAllTagBlocks(response, INNER_BLOCK_PATTERN),
  ]
    .filter((section) => section.length > 0)
    .join("\n");
};

// 短い文も落とさん。refute-r2 2026-09-14 #5: 最低文字数で先に捨てとったので、
// 「腿が湿る。腿が濡れる。腿とろ。」のような短い反復がまるごと数から漏れた。
const splitSentences = (text: string): string[] =>
  text
    .split(/[。！？…]/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

// 数える単位は節（読点区切り）。refute-evasion 2026-09-13 #5: 句点を読点へ替えて
// 「腿が湿る、腿が濡れる、腿がとろける。」と1文に繋げると、3回の言い換えが1回に潰れて
// 素通りしとった。
// ただし部位語は節やのうて文から拾う。「腿の付け根が、じんわりと湿ってくる」のように
// 部位と反応が読点を跨ぐ書き方が普通で、節で切って拾うと組が壊れて逆に見逃す
// （実測: 実ログ60ターンで検出が6→5へ落ちた）。短い節も落とさん——落とすと同じ穴が開く。
const splitClauses = (sentence: string): string[] =>
  sentence
    .split(/[、，,]/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

// 部位を問わず「体液の名詞+流出動詞」が同一文にあれば、部位語が段落ごとに違っても
// 1つの言い換えとみなす。部位語（BODY_PART_PATTERN）の共起を必須にして、体液と
// 無関係などうしの偶然一致（こぼれた飲み物・込み上げる感情等）を誤検知せんようにする。
const FLUID_FLOW_NOUN_PATTERN = /白濁|精液|愛液|体液|液体|熱いもの|蜜/u;
const FLUID_FLOW_VERB_PATTERN = /溢れ|伝い|伝う|垂れ|滴|零れ|こぼれ|染み|濡ら|濡れ|滲/u;
const FLUID_FLOW_KEY = "体液::流れ系";

// 節そのものに部位語がある組（direct）と、文から引き継いだ組（inherited）を分けて返す。
// 引き継ぎは1文につき1回だけ数える——「腿の内側を伝い、染みを作る」は1つの描写であって
// 2回の言い換えやない。読点で切ったからいうて同じ描写が水増しされんようにする。
type ClauseKeys = { direct: string[]; inherited: string[] };

const reactionClassesIn = (clause: string): string[] =>
  Object.entries(REACTION_CLASS_PATTERNS)
    .filter(([, pattern]) => pattern.test(clause))
    .map(([name]) => name);

const bodyPartsIn = (text: string): string[] => [
  ...new Set((text.match(BODY_PART_PATTERN) ?? []).map(canonicalBodyPart)),
];

const pairKeysForClause = (clause: string, sentenceBodyParts: readonly string[]): ClauseKeys => {
  const keys: ClauseKeys = { direct: [], inherited: [] };
  if (sentenceBodyParts.length === 0) return keys;
  const reactionClasses = reactionClassesIn(clause);
  const clauseBodyParts = new Set(bodyPartsIn(clause));
  for (const bodyPart of sentenceBodyParts) {
    const target = clauseBodyParts.has(bodyPart) ? keys.direct : keys.inherited;
    target.push(...reactionClasses.map((reactionClass) => `${bodyPart}::${reactionClass}`));
  }
  if (FLUID_FLOW_NOUN_PATTERN.test(clause) && FLUID_FLOW_VERB_PATTERN.test(clause)) {
    keys.direct.push(FLUID_FLOW_KEY);
  }
  return keys;
};

// 数え上げて、閾値に達した組があればその組を返す。
const countUntilThreshold = (
  keys: readonly string[],
  counts: Map<string, number>,
): string | undefined => {
  for (const key of keys) {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count >= REPETITION_THRESHOLD) return key;
  }
  return undefined;
};

export type ReactionRepetitionResult = {
  ok: boolean;
  // 閾値に達した組（部位::反応クラス、または "体液::流れ系"）。
  repeatedKey?: string;
};

export const reactionRepetitionCheck = (response: string): ReactionRepetitionResult => {
  const narration = extractNarration(response);
  const sentences = splitSentences(narration);
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const bodyParts = bodyPartsIn(sentence);
    const countedInSentence = new Set<string>();
    for (const clause of splitClauses(sentence)) {
      const { direct, inherited } = pairKeysForClause(clause, bodyParts);
      const keys = [...direct, ...inherited.filter((key) => !countedInSentence.has(key))];
      for (const key of keys) countedInSentence.add(key);
      const repeatedKey = countUntilThreshold(keys, counts);
      if (repeatedKey) return { ok: false, repeatedKey };
    }
  }
  return { ok: true };
};
