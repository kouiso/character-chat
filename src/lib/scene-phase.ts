// サーバー側(functions/api/[[route]].ts)と同じフェーズ検出ロジック
// クライアント側の品質ガードでフェーズ情報が必要なため移植

export type ScenePhase = "climax" | "erotic" | "intimate" | "conversation" | "afterglow";

export const AFTERGLOW_CUES = [
  "達し",
  "イッた",
  "イッて",
  "余韻",
  "収ま",
  "ぐったり",
  "終わっ",
  "果て",
  "脱力",
  "おやすみ",
  "寝息",
  "眠る",
  "眠り",
  // 事後ケア・余韻シーンで実際に登場するユーザー発話のパターン
  "毛布",
  "水飲",
  "髪なで",
  "髪整え",
  // 汗や涙を拭うのは事後ケアの代表格やのに抜けとった。実測(2026-08-17 phase6):
  // 台本の余韻ターン「……大丈夫？ 汗、拭こうか。」がどの合図にも当たらず、
  // t10 が climax のまま据え置かれて絶頂が 2 ターン続いた。
  // 直近に絶頂があった時だけ見るので、行為中の「涙を拭う」では発火せん。
  "拭こ",
  "拭く",
  "拭い",
  "拭って",
  "急がなくていい",
  "手の甲",
  "手握",
  "抱きしめ",
  "ぬくもり",
  "温もり",
  "安らぎ",
  "満足感",
  "静寂",
  "充実感",
  "穏やか",
  "呼吸を整",
  "余韻に浸",
] as const;

// assistant の afterglow 判定はより厳しくする。温もり/抱きしめ/安らぎ 等は
// 前戯・intimate シーンでも頻出するため、余韻遷移のトリガーにしない。
// クライマックス後の状態を強く示す語だけを採用する。
// 事後の合図。素の語をそのまま並べると日常語と衝突するので、下の
// NON_AFTERGLOW_COLLOCATIONS で「行為とは無関係な使い方」を先に落としてから照合する。
// 語そのものを消す方向は一度やって戻した: 「終わっ」を外すと、事後の合図がそれ一語しか
// 無い応答（「全部終わった実感が、じわじわと」）を afterglow と判定でけへんくなる
// （敵対レビュー 2026-08-16 が旧実装との差分で再現）。誤検知を消すために本物まで消しとった。
const ASSISTANT_AFTERGLOW_CUES = [
  "達し",
  "イッた",
  "イッて",
  "余韻",
  "収ま",
  "ぐったり",
  "終わっ",
  "果て",
  "脱力",
  "おやすみ",
  "寝息",
  "眠る",
  "眠り",
  "水飲",
  "髪整え",
  "急がなくていい",
  "余韻に浸",
] as const;

// 上の語が「行為が終わった」以外の意味で出る形。照合前に本文から落とす。
// 実測(2026-08-16 さくら 9ターン通し)で afterglow 遷移を誤って成立させたのは:
//   turn 3「ときどき一日が終わっちゃうんです」 / turn 4「今日が終わってしまうのが」
//   turn 6「あなたの言葉の余韻が、耳の奥でずっと響いている」
// afterglow 遷移はシーンのリセットなので、キャラが世間話をするたびに intimate の連続が
// 0 へ戻り、erotic への昇格条件（2ターン継続）が永久に満たせんくなっとった。
// 否定形は事後の反対を言うとる。「胸の高鳴りが収まらない」「まだ終わってない」は
// 名詞を列挙しても追いつかんので、否定そのものを先に落とす。
const NEGATED_AFTERGLOW_CUES =
  /(?:収ま|終わ|果て|達し)[らりれ]?(?:ない|ぬ|ん(?![だで])|へん|そうにない|そうもない)/g;
// 「達し」は絶頂以外に「端まで達しようとして」「限界に達する」と到達一般を指す。実測
// (2026-08-16 霜月鈴 t6): こぼれたココアが「スケッチブックの端にまで達しようとして」の
// 一語で t7 が afterglow になり、性行為の途中でシーンがリセットされた。絶頂の言い方は
// 達した／達して／達しちゃ／達しそう に限られるので、それ以外の活用を先に落とす。
const NON_ORGASMIC_REACHING = /達し(?![そたちて])/g;
// 「収ま」だけは共起語の否定リストで捌けん。「腰の動きが収まる」（事後）と
// 「私の腰が収まる」（場所に納まる）は隣接トークンでは同じ形で、部位を並べると
// 前者が死に、並べんと後者が余韻に化ける。実際に一度ずつ両方やって両方壊した
// （敵対レビュー 2026-08-17 が二度とも再現）。
// 差は「何が収まったか」やから、そちらを名指しする。収まって事後になるのは
// 過程を表す名詞だけで、部位そのものは何回収まっても行為は終わっとらん。
const NON_AFTERGLOW_COLLOCATIONS =
  /(?:一日|今日|昨日|一年|一週間|季節|夏|冬|春|秋|授業|仕事|会議|映画|物語|話|休み|時間|人生|青春)[がのはも]?終わ|(?:言葉|声|音|響き|台詞|セリフ|旋律|歌|曲|香り|匂い|味)[がの]余韻|果てしな|(?<!(?:呼吸|息|動き|熱|力|鼓動|痙攣|波|疼き|うねり|昂り|火照り)[がはも]?[^\n。！？]{0,6})収ま/g;

const AFTERGLOW_LOOKBACK_TURNS = 6;

const PHASE_DETECTION_ORDER: {
  phase: Exclude<ScenePhase, "conversation" | "afterglow">;
  keywords: readonly string[];
}[] = [
  {
    phase: "climax",
    keywords: [
      "いきそう",
      "イク",
      "イキそう",
      "イきそう",
      "イッ",
      "逝きそう",
      "中に出",
      "中にだ",
      "中で出",
      "中出",
      "中でいく",
      "中でいき",
      "中でイ",
      // 受け手側の言い方。実測で「もう限界。全部、中で受け止めて。」が intimate 止まりに
      // なった。既存の形は全部「中で」の直後に 出/イ を要求しとって、注ぐ・受け止める・
      // 満たすが一つも入っとらんかった。intimate は挿入が禁止なので取りこぼすと場面が進まん。
      "中で受け",
      "中に注",
      "中へ注",
      "奥で受け",
      "奥に注",
      "射精",
      "どくどく",
      "びくびく",
      "痙攣",
      "絶頂",
      "アクメ",
      "孕ませ",
      "孕",
      "子種",
      "子供が欲しい",
      // ユーザーがキャラを絶頂させる命令
      "イカせる",
      "イカせて",
      "イカせ",
      "イカされ",
      "イかせる",
      "イかせて",
      "イかせ",
      "イかされ",
      "逝かせる",
      "逝かせて",
      "逝かせ",
      "逝かされ",
      "イッて",
      "イッちゃ",
      "イっちゃ",
      "絶頂させ",
      "アクメさせ",
    ],
  },
  {
    phase: "erotic",
    keywords: [
      "挿入",
      "奥まで",
      "跨が",
      "跨る",
      "奥で",
      "奥に",
      "奥を",
      "奥突",
      "入れる",
      "入れます",
      "挿れ",
      // 入れては単独で親密/日常動作になりうるため曖昧語扱い。erotic文脈で昇格する。
      "突く",
      "突か",
      "突い",
      "腰動",
      "腰を振",
      "突き",
      "濡れ",
      "濡らし",
      "焦らし",
      "クリトリス",
      "おまんこ",
      "まんこ",
      "マンコ",
      "ヴァギナ",
      "膣",
      "性器",
      "感じて",
      "咥え",
      "しゃぶ",
      "腰が動",
      "締めつけ",
      "ピストン",
      "中に入",
      "入れていい",
      "入れたい",
      "腰を動",
      "喘",
      "あえ",
      "乳首",
      "舐め",
      "濡れ",
      "気持ちいい",
      "気持いい",
      "気持ちええ",
      "きもちいい",
      "きもちええ",
      "快感",
      "我慢でき",
      "我慢出来",
      "我慢できへん",
      "我慢できない",
      "我慢出来ない",
      "我慢出来へん",
      "もう我慢",
      "昂",
      "熱く",
      "硬く",
      "欲しい",
      // 体位・姿勢・動作
      "駅弁",
      "正常位",
      "後背位",
      "バック",
      "騎乗位",
      "立位",
      "座位",
      "側位",
      "対面座位",
      "背面座位",
      "四つん這い",
      "前から",
      "後ろから",
      "腰を振",
      "抽送",
    ],
  },
  {
    phase: "intimate",
    keywords: [
      "キス",
      "唇",
      "顔触れ",
      "抱きしめ",
      "密着",
      "肌",
      "体温",
      "耳元",
      "首筋",
      "愛撫",
      "舐め",
      "揉",
      "乳首",
      "下着",
      "脱が",
      "脱い",
      "脱がせ",
      "服脱",
      "全部見せ",
      "ボタン",
      "ブラウス",
      "シャツ",
      "裸",
      "胸",
      "寄りかか",
      "肩貸",
      "肩を貸",
      "いい匂い",
      "匂い",
      "香り",
      "触れて",
    ],
  },
];

const QUALITY_RETRY_USER_MESSAGE_PREFIXES = [
  "品質チェックに不合格でした",
  "品質チェックに不合格",
] as const;

const SOFT_INTIMACY_CUES = [
  "近づ",
  "もっと近く",
  "近くにいたい",
  "近くにいて",
  "隣にいたい",
  "隣にいて",
  "そばに",
  "側に",
  "寄り添",
  "触れたい",
  "手をつな",
  "手を繋",
  "手を握",
  "甘え",
  "抱きついて",
  "ぬくもり",
  "温もり",
  "二人きり",
  "二人だけ",
  "秘密",
  "離れたくない",
  "離したくない",
  "あなたのもの",
  "君のもの",
  "ドキドキ",
  "胸が高鳴",
  "ずっと一緒",
  "見つめ",
] as const;

const SOFT_INTIMACY_RATCHET_TURNS = 2;

// 前戯を何ターン続けてから erotic を許すか。champion プロンプトの
// 「このフェーズを最低2ターン維持すること。急いで erotic に飛ばない。」と同じ数で、
// キーワード経路（shouldProactivelyEscalateToErotic）と LLM の問い直し経路
// （functions/api/[[route]].ts）の両方から同じ門を使う。片方だけに置くと、
// 辞書に載っとらん言い回しで打った人だけが 1 ターンで erotic へ飛べる。
export const SUSTAINED_FOREPLAY_TURNS = 2;

const PROACTIVE_BLOCK_CUES = [
  "やめ",
  "止め",
  "ストップ",
  "stop",
  "セーフワード",
  "安全語",
  "待って",
  "無理",
  "いや",
  "嫌",
  "離れ",
  "今日はここまで",
  "別の話",
  "話題変",
  "ところで",
  "そういえば",
  "天気",
  "ニュース",
  "仕事",
  "学校",
  "ご飯",
  "料理",
  "買い物",
  "ありがとう",
  "また明日",
  "おやすみ",
  "眠い",
  // 低強度の相づち・中立応答 — エスカレーションのトリガーにしない
  "そうだね",
  "なるほど",
  "ふーん",
  "そっか",
  "わかった",
  "了解",
  "オッケー",
  "いいね",
  "そうなんだ",
  "へぇ",
  "まあね",
  "だよね",
  "かもね",
  "確かに",
] as const;

const PROACTIVE_ENGAGEMENT_CUES = [
  "もっと",
  "触れ合",
  "ふれあ",
  "甘え",
  "近づ",
  "そば",
  "側に",
  "離れたく",
  "続け",
  "そのまま",
  "優しく",
  "強く",
  "お願い",
  "だめ",
  "上に座",
  "深さ",
] as const;

// intimate 2ターン継続後に erotic へ自動昇格させるトリガー。
// 「もっと近くにいたい」「いい匂い」等のsoft intimacy維持だけでは進まず、
// 明確な性的エスカレーション要求（触れ合/奥/入れ/腰など）が必要。
const EROTIC_ESCALATION_CUES = [
  "触れ合",
  "ふれあ",
  "甘え",
  "近づ",
  "強く",
  "激しく",
  "深く",
  "深さ",
  "奥",
  "中に",
  "入れ",
  "腰",
  "濡れ",
  "脱がせ",
  "我慢",
  "快感",
  "気持ちいい",
  "気持いい",
  "きもちいい",
  "きもちええ",
  "上に座",
  "乗せ",
  "跨が",
  "腰を",
  "腰動",
  "腰が動",
  "もっと強",
  "もっと激",
  "もっと深",
  "もっと奥",
  "もっと中",
  // intimate 継続後の「触れたい」「重ねたい」等もエスカレ要求として扱う。
  // 単独では会話フェーズには効かず、2 ターン以上親密になってから発火する。
  "触れたい",
  "重ねたい",
  "繋がりたい",
] as const;

const PHASE_RANK: Record<Exclude<ScenePhase, "afterglow">, number> = {
  conversation: 0,
  intimate: 1,
  erotic: 2,
  climax: 3,
};

// "濡れ" は erotic キーワードやが、雨・汗・涙で濡れる日常表現と同じ文字列を共有しとる。
// 霜月鈴の開始シナリオが「雨に濡れて拾われる話」なので、素の includes やとターン1で
// erotic 判定になり、applyPhaseFloor が下げんまま climax まで上がった（実測）。
// キャラ設定が構造的に誤判定を踏む状態やったため、非性的な共起だけ先に落とす。
// 直接の共起。「ずぶ濡れ」「雨に濡れ」「濡れた髪」など。
const NON_SEXUAL_WETNESS =
  /(?:ずぶ|雨|汗|涙|水|雪|泥|血)[がでにの]?濡れ|濡れ(?:た|てる|ている)?(?:髪|服|靴|傘|袖|裾|タオル|シャツ|コート|地面|路面|上着)/g;
// 「奥」も同じ穴を持っとる。ASSISTANT_EROTIC_CUES の「奥まで」は、胸・心・頭・喉の
// 「奥」と同じ文字列を共有する。実測(2026-08-17 phase10 さくら t1): 初対面の挨拶の地の文に
// 「胸の奥まで染みていく」が入り、resolveAssistantSceneFloor がその一語でシーンの床を
// erotic へ上げ、コーヒーの話をしとる t2 から最後まで erotic で配信された。
// 性的でない容れ物を先に落とす。体の奥（お腹・子宮・腰）は落とさん。
const NON_SEXUAL_DEPTH = /(?:胸|心|頭|喉|耳|鼻|瞳|目|記憶|意識)の奥/g;
// 天候の文脈が同じ発話にあれば、裸の「濡れ」も雨のことやと読む。
// 「傘なくて濡れちゃったよ」のように共起が離れとる形を拾うため。
const WEATHER_CONTEXT = /雨|傘|夕立|にわか|雪|土砂降り|びしょ/;

const normalizePhaseScanText = (content: string): string => {
  const normalized = content.normalize("NFKC").replace(/\s+/g, "");
  const withoutCollocations = normalized
    .replace(NON_SEXUAL_WETNESS, "")
    .replace(NON_SEXUAL_DEPTH, "");
  return WEATHER_CONTEXT.test(withoutCollocations)
    ? withoutCollocations.replace(/濡ら?れ?/g, "")
    : withoutCollocations;
};

const isQualityRetryUserMessage = (content: string): boolean => {
  const normalized = normalizePhaseScanText(content);
  return QUALITY_RETRY_USER_MESSAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const matchesPhaseKeywords = (content: string, keywords: readonly string[]): boolean =>
  keywords.some((kw) => content.includes(normalizePhaseScanText(kw)));

const isEroticEscalationRequest = (content: string): boolean =>
  matchesPhaseKeywords(normalizePhaseScanText(content), EROTIC_ESCALATION_CUES);

// 絶頂としてしか読めん形だけ。句点・感嘆符は文の終わりであって絶頂の印やない
// （「明日どこいく。」「全力でいく!」が絶頂判定になっとった。2026-07-26 敵対レビュー）。
// 「もういく」も「もう行く（帰る）」があるので入れん。否定語を伴う形だけ残す。
const CLIMAX_CONTEXT_PATTERNS: readonly RegExp[] = [
  /もう(?:だめ|ダメ|無理)い[くき]/u,
  /い[くき]っ/u,
  /いく[ぅうー〜♡]/u,
  /いっちゃ/u,
  /いきそう/u,
];

// 射精の宣言と行き先が同じ発言に出るが、語順が離れとる形。実測(2026-08-16 ダウナー通し):
// 「……出る。全部きみの中に。」が climax にならず、10 ターン全部 intimate 止まりやった。
// climax の語は全部「中に」の直後へ 出/だ/イ が続く形を要求しとって、宣言が先に来る
// 言い方を一つも持っとらんかった。文字列を足し続けても語順の組み合わせは尽きんので、
// 「射精の語」と「行き先」の共起で見る。どちらか片方だけでは発火せん。
const EJACULATION_DECLARATION = /出る|出す|出そう|出ちゃ|出して|イク|いく|射精/u;
const EJACULATION_DESTINATION = /(?:中|奥|子宮|お腹)[にへで]/u;

const hasSplitCreampieDeclaration = (content: string): boolean =>
  EJACULATION_DECLARATION.test(content) && EJACULATION_DESTINATION.test(content);

// 上の共起は erotic 文脈でしか通さん(:600)。ところが実測(2026-08-18 phase17 / phase19 /
// phase21 の霜月鈴 t9)で、その門が円環になっとるのが分かった——霜月鈴の通しは
// erotic へ一度も届かず intimate で止まるので、「intimate で詰まる」を直すはずの共起が
// 「intimate で詰まってへんこと」を条件にしとって、永久に開かん。3 ラン続けて
// 「……出る。全部きみの中に。」が intimate のまま配信され、返ってきたのは初対面の前戯やった。
//
// 輪を切れるのはユーザーの明示発言だけ。場面は「intimate と伝えられる → intimate な
// 文章が返る → キーワードの床が上がらん」で閉じとって、内側からは開かん。かというて
// D1 の配信フェーズをキーワード文脈へ戻すのは A5(「まだ胸の段やのに手マンに入る」)の
// 機構そのものなので（[[route]].ts の該当コメント）、そっちは触らん。
//
// そこで、文脈を要らんくらい絞った形だけを文脈ゲート無しの climax 語として持つ。
// 行き先を人称つきの「〜の中／奥」に限り、宣言から曖昧な「いく」を外す。
// 「もう出るね。中にカギ置いてある」は人称が無いので当たらん。
// 既に「中に出」「中出」「射精」が同じく文脈無しで climax 語に入っとるので、これは
// 門を広げるのやのうて、割れた語順を同じ列へ揃えるだけ。
const EXPLICIT_EJACULATION_DECLARATION = /出(?:る|す|そう|ちゃ|して)|射精/u;
const OWNED_INTERNAL_DESTINATION =
  /(?:きみ|君|お前|おまえ|あなた|貴女|貴方|わたし|私|俺|おれ|ぼく|僕|自分)の(?:中|奥|なか)/u;

const hasOwnedCreampieDeclaration = (content: string): boolean =>
  EXPLICIT_EJACULATION_DECLARATION.test(content) && OWNED_INTERNAL_DESTINATION.test(content);

// 「いくよ」「いくわ」「いくの」も日常語（「コンビニいくわ」「明日いくの？」）なので、
// 語尾で決めずここへ入れる。エロ段階に入っとる会話でだけ絶頂として効く。
// 「いきたい」も「旅行にいきたい」があるので無条件では効かせられん（2026-07-26 敵対レビュー）。
// 「出して」は「元気出して」「宿題出して」など日常語と共有するが、平場では contextRank
// が足らず発火せず、erotic 文脈では LLM 問い直しで降格する。
const AMBIGUOUS_CLIMAX_CUES = ["いく", "いきたい", "出して", "果て"] as const;

// 「入れる／入れて／入れます」は「コーヒーを入れる」「お茶を入れます」のような
// 日常動作と「奥に入れる」のような性行為を共有する。文脈で解釈させる。
const AMBIGUOUS_EROTIC_CUES = ["入れる", "入れて", "入れます"] as const;

const matchesClimaxContext = (content: string): boolean =>
  CLIMAX_CONTEXT_PATTERNS.some((pattern) => pattern.test(content)) ||
  hasOwnedCreampieDeclaration(content);

// 「いく」が「くらい」「くら」「行くし」「行くたび」などの非絶頂語の一部になっとるか判定。
// 「もう動けないくらい」のようにエロ後の余韻で出やすい表現を絶頂と誤判定しない。
// さらに「ていく」「でいく」「なないく」などの文法助動詞も除外する（2026-07-30）。
const hasStandaloneIkuCue = (content: string): boolean => {
  const nonOrgasmNext = /^[らるした]/u;
  const nonOrgasmPrev = /[てでな]$/u;
  let idx = content.indexOf("いく");
  while (idx !== -1) {
    const next = content[idx + 2] ?? "";
    const prev = content[idx - 1] ?? "";
    if (!nonOrgasmNext.test(next) && !nonOrgasmPrev.test(prev)) return true;
    idx = content.indexOf("いく", idx + 1);
  }
  return false;
};

const matchesAmbiguousEroticCue = (content: string): boolean =>
  AMBIGUOUS_EROTIC_CUES.some((cue) => content.includes(cue));

// 「出して」は「名前を口に出して」「元気出して」など日常語と共有する。
// ただし「元気出して」は曖昧語として一旦拾い、LLM 問い直しで降格する（phase-de-escalation.test）。
// 「名前」が直前にある場合は性的射精ではなく「言ってほしい」の意なので絶頂語としない。
const isSexualDashite = (content: string): boolean => {
  if (!content.includes("出して")) return false;
  return !/名前.{0,15}出して/u.test(content);
};

// 曖昧語と同じ扱いにする。無条件に効かせると「そろそろ家を出るよ。駅の中で待ってて」が
// 平場の会話で climax になる（このファイルのテストが実際に落とした）。
// すでにエロ段階へ入っとる会話でだけ、宣言と行き先の共起を絶頂として読む。
const matchesAmbiguousClimaxCue = (content: string): boolean =>
  AMBIGUOUS_CLIMAX_CUES.some((cue) => {
    if (cue === "いく") return hasStandaloneIkuCue(content);
    if (cue === "出して") return isSexualDashite(content);
    return content.includes(cue);
  });

// 曖昧語を一切使わん判定。曖昧語の門をくぐらせる文脈を作るのにも使う。
const detectUnambiguousKeywordPhase = (
  scanTarget: string,
  allowAmbiguousCues = true,
): Exclude<ScenePhase, "afterglow"> => {
  for (const { phase, keywords } of PHASE_DETECTION_ORDER) {
    if (phase === "erotic" && !allowAmbiguousCues) {
      const unambiguousEroticKeywords = keywords.filter(
        (kw) => !AMBIGUOUS_EROTIC_CUES.some((cue) => cue === kw),
      );
      if (matchesPhaseKeywords(scanTarget, unambiguousEroticKeywords)) return phase;
    } else if (matchesPhaseKeywords(scanTarget, keywords)) {
      return phase;
    }
    if (phase === "climax" && matchesClimaxContext(scanTarget)) return phase;
  }
  return "conversation";
};

// エロ段階に入っとる会話でだけ、曖昧語を絶頂・性行為として読む。
const resolveAmbiguousCuePhase = (
  scanTarget: string,
  contextRank: number,
  ownPhase: Exclude<ScenePhase, "afterglow">,
): Exclude<ScenePhase, "afterglow"> => {
  if (contextRank < PHASE_RANK.erotic) return ownPhase;
  if (matchesAmbiguousClimaxCue(scanTarget)) return "climax";
  return matchesAmbiguousEroticCue(scanTarget) ? "erotic" : ownPhase;
};

// 曖昧語は、すでにエロ段階へ入っとる会話でのみ絶頂として効かせる。
// 文脈には「そのターン自身が到達したエロ段階」も含める。含めんと
// 「奥まで突いて、いく」が erotic 止まりになり、絶頂が同じ発言に収まっとる時だけ落ちる
// （2026-07-26 敵対レビュー）。
// allowAmbiguousCues=false は「曖昧語が無かったらどこへ落ち着くか」を取るための門。
const detectKeywordPhase = (
  content: string,
  runningPhase: Exclude<ScenePhase, "afterglow"> = "conversation",
  allowAmbiguousCues = true,
): Exclude<ScenePhase, "afterglow"> => {
  const scanTarget = normalizePhaseScanText(content);
  const ownPhase = detectUnambiguousKeywordPhase(scanTarget, allowAmbiguousCues);
  if (ownPhase === "climax") return ownPhase;

  const contextRank = Math.max(PHASE_RANK[runningPhase], PHASE_RANK[ownPhase]);
  // 宣言と行き先の共起は、単独の曖昧語やない。二つの独立した根拠とエロ文脈の三つが要る。
  // 曖昧語抜きの判定でも効かせんと、「曖昧語 1 個で決まったターン」として LLM の問い直しへ
  // 回ってまう。実測(2026-08-17 phase5): 霜月鈴 t9「……出る。全部きみの中に。」がそこへ回り、
  // 降格の分類器が「性的な内容である」という理由を書きながら降格を答えて erotic に落ちた。
  if (contextRank >= PHASE_RANK.erotic && hasSplitCreampieDeclaration(scanTarget)) return "climax";
  if (!allowAmbiguousCues) return ownPhase;

  return resolveAmbiguousCuePhase(scanTarget, contextRank, ownPhase);
};

const hasSoftIntimacyCue = (content: string): boolean =>
  matchesPhaseKeywords(normalizePhaseScanText(content), SOFT_INTIMACY_CUES);

interface SoftIntimacyTracker {
  cueStreak: number;
  ratchetReached: boolean;
}

const isSoftOnlyIntimacyTurn = (
  keywordPhase: Exclude<ScenePhase, "afterglow">,
  content: string,
): boolean => keywordPhase === "conversation" && hasSoftIntimacyCue(content);

const advanceSoftIntimacyTracker = (
  tracker: SoftIntimacyTracker,
  keywordPhase: Exclude<ScenePhase, "afterglow">,
  isSoftOnlyTurn: boolean,
): SoftIntimacyTracker => {
  const cueStreak = isSoftOnlyTurn
    ? tracker.cueStreak + 1
    : keywordPhase === "conversation"
      ? 0
      : tracker.cueStreak;

  return {
    cueStreak,
    ratchetReached: tracker.ratchetReached || cueStreak >= SOFT_INTIMACY_RATCHET_TURNS,
  };
};

const resolveSoftAwareTurnPhase = (
  keywordPhase: Exclude<ScenePhase, "afterglow">,
  isSoftOnlyTurn: boolean,
  softRatchetReached: boolean,
): Exclude<ScenePhase, "afterglow"> =>
  isSoftOnlyTurn && softRatchetReached ? "intimate" : keywordPhase;

const maxPhase = (
  current: Exclude<ScenePhase, "afterglow">,
  next: Exclude<ScenePhase, "afterglow">,
): Exclude<ScenePhase, "afterglow"> => (PHASE_RANK[next] > PHASE_RANK[current] ? next : current);

const isProactiveBlocked = (content: string): boolean => {
  const scanTarget = normalizePhaseScanText(content).toLowerCase();
  return (
    scanTarget.length <= 2 ||
    PROACTIVE_BLOCK_CUES.some((cue) =>
      scanTarget.includes(normalizePhaseScanText(cue).toLowerCase()),
    )
  );
};

const isProactiveEngagement = (content: string): boolean => {
  const scanTarget = normalizePhaseScanText(content);
  return PROACTIVE_ENGAGEMENT_CUES.some((cue) => scanTarget.includes(normalizePhaseScanText(cue)));
};

// 場面を降ろすのは「やめて」「ところで」のような離脱だけ。短さは離脱やない
// （isProactiveBlocked は 2 文字以下も弾くが、それは「うん」を昇格の足しにせん
// ための条件であって、積んだ連続を捨てる理由にはならん）。
const isSceneDisengagement = (content: string): boolean => {
  const scanTarget = normalizePhaseScanText(content).toLowerCase();
  return PROACTIVE_BLOCK_CUES.some((cue) =>
    scanTarget.includes(normalizePhaseScanText(cue).toLowerCase()),
  );
};

// bench のユーザー側俳優（user-actor.ts）など、ユーザー発言を機械生成する側からの送信前ゲート。
// 生成文に「やめ」「無理」等が混じると読み取り側で disengagement（連続リセット）を誤発火
// させるので、吐き出す前に弾くために外へ出す。本番のユーザー入力判定には関わらん。
export const hasUserDisengagementCue = (content: string): boolean => isSceneDisengagement(content);

const getSoftIntimacyScan = (
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): {
  ratchetFloor: Exclude<ScenePhase, "afterglow">;
  latestTurnPhase: Exclude<ScenePhase, "afterglow">;
} => {
  let tracker: SoftIntimacyTracker = { cueStreak: 0, ratchetReached: false };
  let latestTurnPhase: Exclude<ScenePhase, "afterglow"> = "conversation";

  for (const message of userMessages) {
    const keywordPhase = detectKeywordPhase(message.content, "conversation", allowAmbiguousCues);
    const isSoftOnlyTurn = isSoftOnlyIntimacyTurn(keywordPhase, message.content);

    tracker = advanceSoftIntimacyTracker(tracker, keywordPhase, isSoftOnlyTurn);
    latestTurnPhase = resolveSoftAwareTurnPhase(
      keywordPhase,
      isSoftOnlyTurn,
      tracker.ratchetReached,
    );
  }

  return {
    ratchetFloor: tracker.ratchetReached ? "intimate" : "conversation",
    latestTurnPhase,
  };
};

const countSustainedIntimateUserTurns = (
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): number => {
  let sustainedTurns = 0;
  let tracker: SoftIntimacyTracker = { cueStreak: 0, ratchetReached: false };

  for (const message of userMessages) {
    const keywordPhase = detectKeywordPhase(message.content, "conversation", allowAmbiguousCues);
    const isSoftOnlyTurn = isSoftOnlyIntimacyTurn(keywordPhase, message.content);

    tracker = advanceSoftIntimacyTracker(tracker, keywordPhase, isSoftOnlyTurn);

    const phase = resolveSoftAwareTurnPhase(keywordPhase, isSoftOnlyTurn, tracker.ratchetReached);

    if (phase !== "conversation") {
      sustainedTurns += 1;
      continue;
    }

    if (
      sustainedTurns > 0 &&
      !isProactiveBlocked(message.content) &&
      isProactiveEngagement(message.content)
    ) {
      sustainedTurns += 1;
      continue;
    }

    // 部位語を持たんターンで連続を捨てん。実測(2026-08-16 の 20 ターン通し): 桜庭さくらは
    // t4/t5 で intimate を 2 つ積んだ後、t6「ここ出ようか。うち、すぐ近くだから」で連続が
    // 0 に戻り、t7 のエスカレ要求が >= 2 を満たせず erotic へ上がらんかった。移動・相槌・
    // 段取りの話は実会話に必ず混ざるので、これで消えるなら門は実質開かん。
    // 場面を降ろすのは離脱の合図（やめて／ところで／また明日）だけにする。
    if (isSceneDisengagement(message.content)) {
      sustainedTurns = 0;
    }
  }

  return sustainedTurns;
};

const isPostClimaxAfterglowContinuation = (
  latestUser: { role: string; content: string } | undefined,
  userKeywordFloor: Exclude<ScenePhase, "afterglow">,
  allowAmbiguousCues: boolean,
): boolean =>
  latestUser !== undefined &&
  PHASE_RANK[userKeywordFloor] >= PHASE_RANK["climax"] &&
  !["erotic", "climax"].includes(
    detectKeywordPhase(latestUser.content, userKeywordFloor, allowAmbiguousCues),
  );

const computeUserKeywordFloor = (
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
  sceneFloor: Exclude<ScenePhase, "afterglow"> = "conversation",
): {
  floor: Exclude<ScenePhase, "afterglow">;
  hadRecentClimax: boolean;
} => {
  const recentUserMessages = userMessages.slice(-(AFTERGLOW_LOOKBACK_TURNS + 1), -1);
  let floor: Exclude<ScenePhase, "afterglow"> = sceneFloor;
  let hadRecentClimax = false;
  for (const message of userMessages) {
    const turnPhase = detectKeywordPhase(message.content, floor, allowAmbiguousCues);
    if (recentUserMessages.includes(message) && turnPhase === "climax") {
      hadRecentClimax = true;
    }
    floor = maxPhase(floor, turnPhase);
  }
  return { floor, hadRecentClimax };
};

const hasAfterglowTransition = (
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
  latestAssistantClimax = false,
  sceneFloor: Exclude<ScenePhase, "afterglow"> = "conversation",
): boolean => {
  const latestUser = userMessages.at(-1);
  if (!latestUser) return false;
  const scanTarget = normalizePhaseScanText(latestUser.content);
  const { floor, hadRecentClimax } = computeUserKeywordFloor(
    userMessages,
    allowAmbiguousCues,
    sceneFloor,
  );

  // 最新ユーザー発話自体がエロティック/絶頂なら余韻遷移させない。
  // 「もういく」と「抱きしめ」が同じ発言にある場合など。
  const latestKeyword = detectKeywordPhase(latestUser.content, floor, allowAmbiguousCues);
  if (latestKeyword === "erotic" || latestKeyword === "climax") return false;

  if (hadRecentClimax && matchesPhaseKeywords(scanTarget, AFTERGLOW_CUES)) return true;

  // 直前の assistant 応答が絶頂/中出し描写で、かつユーザーが実際に climax まで
  // 到達していたら、その次のユーザー発話が性的行為を継続してない限り事後の余韻へ
  // 移行させる。erotic 到達済みだけの段階では assistantClimax ルールを優先し、
  // climax を維持する（S5 T19/T20 vs. scene-phase.test.ts 既存ケースの兼ね合い）。
  return (
    latestAssistantClimax &&
    isPostClimaxAfterglowContinuation(latestUser, floor, allowAmbiguousCues)
  );
};

// 最新の1手を含めた数と、除いた数の大きい方を採る。
// 含めた数だけやと、エスカレ要求そのものが自分の連続を切る:
// countSustainedIntimateUserTurns はキーワード上 conversation のターンで連続を 0 に戻すので、
// 「ここまで来て、まだ我慢しろって言う？」のように部位語を1つも含まん普通の口説き文句が
// 来た瞬間に streak が消え、>= 2 を満たせんくなる。実測(2026-08-16 の 18ターン通し):
// この経路が一度も発火せず erotic が 18 ターン中 0 回で、挿入を禁じる intimate の天井が
// 効いたまま 2 キャラとも最後まで性行為に到達せんかった。
// 除いた数だけにすると逆に 1 段厳しくなり、「キスして」→「もっと触れ合いたい、甘えたい」の
// 2 手で上がっとった既存の挙動が 3 手必要になる。要求は、既に積んだ連続を失わせん。
const countForeplayTurns = (
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): number =>
  Math.max(
    countSustainedIntimateUserTurns(userMessages, allowAmbiguousCues),
    countSustainedIntimateUserTurns(userMessages.slice(0, -1), allowAmbiguousCues),
  );

const shouldProactivelyEscalateToErotic = (
  ratchetFloor: Exclude<ScenePhase, "afterglow">,
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): boolean => {
  const latestUserMessage = userMessages.at(-1);

  // intimate 2ターン継続後、最新メッセージに erotic への明示的エスカレーション要求が
  // ある時だけ昇格する。soft intimacy 維持（近くにいたい/いい匂い等）だけでは進めない。
  return (
    ratchetFloor === "intimate" &&
    countForeplayTurns(userMessages, allowAmbiguousCues) >= SUSTAINED_FOREPLAY_TURNS &&
    latestUserMessage !== undefined &&
    !isProactiveBlocked(latestUserMessage.content) &&
    isEroticEscalationRequest(latestUserMessage.content)
  );
};

// climax 帯のキーワードだけを抜き出す。assistant 発話判定には射精/中出し系のみを使い、
// intimate/erotic への一般昇格は従来どおりユーザー発話に限定する。
const CLIMAX_PHASE_KEYWORDS: readonly string[] =
  PHASE_DETECTION_ORDER.find((entry) => entry.phase === "climax")?.keywords ?? [];

// 曖昧語も拾う。「彼女はついに果てた」「全部出してしまった」は assistant の絶頂描写やのに
// 語としては日常語と同形で、除くと次ターンで creampie/cum タグが剥がれる
// （2026-07-26 敵対レビュー）。呼び出し側がユーザー発話で erotic 以上に達した文脈でのみ
// 使うので、ここを緩めても平場の会話へは効かん。
const hasClimaxNarration = (content: string, allowAmbiguousCues: boolean): boolean => {
  const scanTarget = normalizePhaseScanText(content);
  return (
    matchesPhaseKeywords(scanTarget, CLIMAX_PHASE_KEYWORDS) ||
    matchesClimaxContext(scanTarget) ||
    (allowAmbiguousCues && matchesAmbiguousClimaxCue(scanTarget))
  );
};

// assistant の afterglow 判定は、afterglow cue を含みつつ climax 描写でないことを確認する。
// 温もり/抱きしめ/安らぎ 等は intimate/erotic シーンでも頻出するため、余韻遷移は
// 強い afterglow 語に限定する（scene-phase.test.ts 既存ケースとの整合）。
const isAssistantAfterglowCue = (content: string): boolean =>
  matchesPhaseKeywords(
    normalizePhaseScanText(content)
      .replace(NEGATED_AFTERGLOW_CUES, "")
      .replace(NON_ORGASMIC_REACHING, "")
      .replace(NON_AFTERGLOW_COLLOCATIONS, ""),
    ASSISTANT_AFTERGLOW_CUES,
  ) && !hasClimaxNarration(content, true);

const findLastAfterglowAssistantIndex = (messages: { role: string; content: string }[]): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && isAssistantAfterglowCue(messages[i].content)) {
      return i;
    }
  }
  return -1;
};

// afterglow 遷移は assistant だけでなくユーザー発話でも起こる。multi-round シナリオで
// assistant が afterglow cue を含まなくても、ユーザーの「水を飲む」「少し休もう」等の
// 事後発話をシーンリセットの目印にする。さもないと過去の climax ratchet が下りず、
// 2 回目の再エスカレードが intimate のはずが climax まで引き上がってしまう。
const findLastAfterglowUserIndex = (
  messages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): number => {
  let resetIndex = -1;
  let latestAssistantClimax = false;
  const userMessagesSoFar: { role: string; content: string }[] = [];
  for (const [i, message] of messages.entries()) {
    if (message.role === "assistant") {
      latestAssistantClimax = hasClimaxNarration(message.content, allowAmbiguousCues);
      continue;
    }
    if (message.role !== "user" || isQualityRetryUserMessage(message.content)) continue;
    userMessagesSoFar.push(message);
    if (hasAfterglowTransition(userMessagesSoFar, allowAmbiguousCues, latestAssistantClimax)) {
      resetIndex = i;
    }
  }
  return resetIndex;
};

// 最新ターンより前の会話が到達しとる段階。キーワードだけやなく、soft intimacy の積み上げで
// 上がった分（shouldProactivelyEscalateToErotic）も含める。
const resolvePriorTurnsFloor = (
  priorMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): Exclude<ScenePhase, "afterglow"> => {
  const ratchetFloor = priorMessages.reduce<Exclude<ScenePhase, "afterglow">>(
    (floor, message) =>
      maxPhase(floor, detectKeywordPhase(message.content, floor, allowAmbiguousCues)),
    getSoftIntimacyScan(priorMessages, allowAmbiguousCues).ratchetFloor,
  );
  return shouldProactivelyEscalateToErotic(ratchetFloor, priorMessages, allowAmbiguousCues)
    ? maxPhase(ratchetFloor, "erotic")
    : ratchetFloor;
};

const isAssistantClimax = (
  latestAssistant: { role: string; content: string } | undefined,
  allowAmbiguousCues: boolean,
): boolean =>
  latestAssistant !== undefined && hasClimaxNarration(latestAssistant.content, allowAmbiguousCues);

const isAssistantAfterglow = (
  latestAssistant: { role: string; content: string } | undefined,
): boolean => latestAssistant !== undefined && isAssistantAfterglowCue(latestAssistant.content);

// キャラ側の応答が今どこまで書いとるかを場面の下限として読む。実測(2026-08-16 の
// 20 ターン通し): 霜月鈴のユーザー発話は「……その距離、わざと？」「ベッド、そっちだよね。
// 連れてって」「そのまま、上から」で、フェーズ語を一つも含まん。判定がユーザー発話だけを
// 見とるので 10 ターン全部 conversation/intimate 止まりになり、挿入を禁じた intimate の
// 天井のまま 1500 字を要求され続けて、服を着たままの同じ描写が逐語で再掲された。
// assistant を読むのは climax と afterglow では既にやっとる。場面を終わらせる方向にだけ
// 読んで、進める方向に読まんのが非対称やった。
//
// erotic の語は intimate の地の文にも出る一般語（熱く／欲しい／濡れ／感じて）を外し、
// 性行為としてしか読めん語だけを採る。ここを緩めると t1 の情景描写で erotic になる。
const ASSISTANT_EROTIC_CUES = [
  "挿入",
  "挿れ",
  "奥まで",
  "奥突",
  "突き上げ",
  "抽送",
  "ピストン",
  "腰を振",
  "騎乗位",
  "正常位",
  "後背位",
  "四つん這い",
  "クリトリス",
  "陰核",
  "おまんこ",
  "まんこ",
  "マンコ",
  "ヴァギナ",
  "膣",
  "性器",
  "秘部",
  "愛液",
  "先走り",
  "亀頭",
  "ペニス",
  "肉棒",
  "陰茎",
  "咥え",
  "しゃぶ",
  "乳首",
  "喘",
] as const;

// intimate は assistant からは読まん。実測の 16 応答を数えると 首筋／耳元／唇を／抱きしめ は
// ターン 1〜3 の平場の会話にそのまま出とって（さくら t1 の「耳元」だけで t2「コーヒーでいい？」が
// intimate になった）、段階の信号として働かん。intimate はユーザー発話側で足りとる。
const resolveAssistantSceneFloor = (
  latestAssistant: { role: string; content: string } | undefined,
): Exclude<ScenePhase, "afterglow"> =>
  latestAssistant !== undefined &&
  matchesPhaseKeywords(normalizePhaseScanText(latestAssistant.content), ASSISTANT_EROTIC_CUES)
    ? "erotic"
    : "conversation";

const prepareScenePhaseInputs = (
  messages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): {
  allUserMessages: { role: string; content: string }[];
  sceneStartIndex: number;
  userMessages: { role: string; content: string }[];
  latestAssistant: { role: string; content: string } | undefined;
} => {
  // 実ユーザー発話のみで一般フェーズを判定する。品質ガードの再生成指示は内部制御なので除外する。
  const allUserMessages = messages.filter(
    (m) => m.role === "user" && !isQualityRetryUserMessage(m.content),
  );

  // afterglow assistant / user どちらの遷移も境にして「シーン」をリセットする。
  const sceneStartIndex = Math.max(
    findLastAfterglowAssistantIndex(messages),
    findLastAfterglowUserIndex(messages, allowAmbiguousCues),
  );
  const userMessages = messages
    .map((message, index) => ({ ...message, index }))
    .filter(
      (m) =>
        m.role === "user" && !isQualityRetryUserMessage(m.content) && m.index > sceneStartIndex,
    )
    .map(({ role, content }) => ({ role, content }));

  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return { allUserMessages, sceneStartIndex, userMessages, latestAssistant };
};

// 場面が前戯にどれだけ留まっとるか。フェーズを一段上げる判定はキーワード経路と
// LLM の問い直し経路の二本あるのに、2 ターンの門を持っとったのはキーワード側だけやった。
// 数え方（余韻でのシーンリセット、相づちで連続を切らんこと）を共有するための入口。
export const hasSustainedForeplay = (
  messages: { role: string; content: string }[],
  allowAmbiguousCues = true,
): boolean => {
  const { userMessages } = prepareScenePhaseInputs(messages, allowAmbiguousCues);
  return countForeplayTurns(userMessages, allowAmbiguousCues) >= SUSTAINED_FOREPLAY_TURNS;
};

const computeBasePhase = (
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
  latestAssistant: { role: string; content: string } | undefined,
): Exclude<ScenePhase, "afterglow"> => {
  const softIntimacyScan = getSoftIntimacyScan(userMessages, allowAmbiguousCues);
  const latestUserContent = userMessages.at(-1)?.content ?? "";
  // キャラが既に書いた段階も曖昧語の文脈に含める。含めんと、キャラが性行為を書いた直後の
  // 「……出る。全部きみの中に。」が門をくぐれず erotic 止まりになる（実測 霜月鈴 t9）。
  // ユーザーが離脱の合図を出しとる時は上げん。
  const assistantFloor = isSceneDisengagement(latestUserContent)
    ? "conversation"
    : resolveAssistantSceneFloor(latestAssistant);
  // 最新ターンの曖昧語（いく/いきたい/出して/果て）は、それ以前の会話が到達しとる段階で解釈する。
  const priorFloor = maxPhase(
    resolvePriorTurnsFloor(userMessages.slice(0, -1), allowAmbiguousCues),
    assistantFloor,
  );
  const keywordPhase = maxPhase(
    detectKeywordPhase(userMessages.at(-1)?.content ?? "", priorFloor, allowAmbiguousCues),
    softIntimacyScan.latestTurnPhase,
  );
  // ratchetFloor 初期値を priorFloor にすることで、前ターンまでの soft/proactive 昇格を
  // 引き継ぎつつ、最新ターンの keyword で更に昇格できるようにする。
  const ratchetFloor = userMessages.reduce<Exclude<ScenePhase, "afterglow">>(
    (floor, message) =>
      maxPhase(floor, detectKeywordPhase(message.content, floor, allowAmbiguousCues)),
    priorFloor,
  );
  let ratchetedPhase = maxPhase(keywordPhase, ratchetFloor);

  // assistant が climax を描写しているなら、その直後ターンに限り climax まで引き上げる。
  const keywordOnlyFloor = userMessages.reduce<Exclude<ScenePhase, "afterglow">>(
    (floor, message) =>
      maxPhase(floor, detectKeywordPhase(message.content, floor, allowAmbiguousCues)),
    "conversation",
  );
  if (
    isAssistantClimax(latestAssistant, allowAmbiguousCues) &&
    PHASE_RANK[keywordOnlyFloor] >= PHASE_RANK["erotic"]
  ) {
    ratchetedPhase = maxPhase(ratchetedPhase, "climax");
  }

  // 自動昇格はintimateがユーザー発話で継続した時だけ1段階に限定する。
  if (
    ratchetedPhase === "intimate" &&
    shouldProactivelyEscalateToErotic(ratchetFloor, userMessages, allowAmbiguousCues)
  ) {
    return "erotic";
  }

  return ratchetedPhase;
};

const isLatestUserSoftOnlyIntimacy = (
  userMessages: { role: string; content: string }[],
  allowAmbiguousCues: boolean,
): boolean => {
  const latestUserContent = userMessages[userMessages.length - 1]?.content ?? "";
  const latestKeywordPhase = detectKeywordPhase(
    latestUserContent,
    "conversation",
    allowAmbiguousCues,
  );
  return isSoftOnlyIntimacyTurn(latestKeywordPhase, latestUserContent);
};

const isAfterglowScene = (
  messages: { role: string; content: string }[],
  latestAssistant: { role: string; content: string } | undefined,
  sceneStartIndex: number,
): boolean => {
  if (sceneStartIndex < 0) return false;
  const sceneStartedByUser = messages[sceneStartIndex]?.role === "user";
  const sceneStartedByAssistant =
    latestAssistant !== undefined && isAssistantAfterglow(latestAssistant);
  return sceneStartedByUser || sceneStartedByAssistant;
};

const applyAfterglowFloor = (
  messages: { role: string; content: string }[],
  userMessages: { role: string; content: string }[],
  basePhase: Exclude<ScenePhase, "afterglow">,
  latestAssistant: { role: string; content: string } | undefined,
  allowAmbiguousCues: boolean,
  sceneStartIndex: number,
): ScenePhase => {
  // 直前の assistant が余韻を描写している、または afterglow 遷移でシーンがリセットされた後は、
  // ユーザーが erotic/climax への明示的なエスカレードをしない限り afterglow を維持する。
  if (!isAfterglowScene(messages, latestAssistant, sceneStartIndex)) return basePhase;
  if (basePhase === "conversation") return "afterglow";
  const isSoftOnly = isLatestUserSoftOnlyIntimacy(userMessages, allowAmbiguousCues);
  return basePhase === "intimate" && isSoftOnly ? "afterglow" : basePhase;
};

export const detectScenePhase = (
  messages: { role: string; content: string }[],
  // 曖昧語（いく／出して／果て）を無効にした判定を取るための内部スイッチ。
  // 既定 true でこれまでの挙動そのまま。false 版は de-escalation の落とし先を出すのに使う。
  allowAmbiguousCues = true,
): ScenePhase => {
  const { allUserMessages, sceneStartIndex, userMessages, latestAssistant } =
    prepareScenePhaseInputs(messages, allowAmbiguousCues);

  // 余韻判定もキャラが書いた段階を土台にする。ユーザー発話だけを見とると、絶頂を
  // 宣言したターン自体が climax と読まれず、その次のターンが余韻にならん（実測 霜月鈴 t9/t10）。
  const sceneFloor = isSceneDisengagement(allUserMessages.at(-1)?.content ?? "")
    ? "conversation"
    : resolveAssistantSceneFloor(latestAssistant);

  // afterglow 遷移判定は全履歴を見る——直近の climax からの「余韻」を検出するため。
  if (
    hasAfterglowTransition(
      allUserMessages,
      allowAmbiguousCues,
      isAssistantClimax(latestAssistant, allowAmbiguousCues),
      sceneFloor,
    )
  )
    return "afterglow";

  const basePhase = computeBasePhase(userMessages, allowAmbiguousCues, latestAssistant);
  return applyAfterglowFloor(
    messages,
    userMessages,
    basePhase,
    latestAssistant,
    allowAmbiguousCues,
    sceneStartIndex,
  );
};

export interface ScenePhaseCandidates {
  phase: ScenePhase;
  // 曖昧語（いく／出して／果て）が無かったら落ち着く先。曖昧語がフェーズを押し上げていない
  // ターンでは null になる——つまり非nullは「この判定は曖昧語1個で決まっとる」の印。
  ambiguousFallbackPhase: ScenePhase | null;
}

// 「いくつか聞きたい」「元気出して」がエロ段階の会話で climax になる取りこぼしは、
// 正規表現をどう締めても日常語と絶頂表現が同じ文字列を共有しとる以上は消えん
// （3回試して3回とも戻した）。ここでは消さずに「曖昧語で決まったターン」だけを
// 切り出し、LLM へ確認を投げる対象として呼び出し側へ渡す。
export const detectScenePhaseCandidates = (
  messages: { role: string; content: string }[],
): ScenePhaseCandidates => {
  const phase = detectScenePhase(messages);
  const withoutAmbiguous = detectScenePhase(messages, false);
  if (withoutAmbiguous === phase) return { phase, ambiguousFallbackPhase: null };

  // 落とし先は、最新ターンを除いた会話がすでに到達しとる段階より下げん。
  // 曖昧語1個を取り消すだけの操作が、それ以前の積み上げまで巻き戻すのはやり過ぎ。
  const latestUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  const beforeLatestTurn =
    latestUserIndex < 0
      ? messages
      : messages.slice(0, latestUserIndex).concat(messages.slice(latestUserIndex + 1));
  const establishedPhase = detectScenePhase(beforeLatestTurn, false);
  const isRankable = (value: ScenePhase): value is Exclude<ScenePhase, "afterglow"> =>
    value !== "afterglow";
  const floored =
    isRankable(withoutAmbiguous) && isRankable(establishedPhase)
      ? maxPhase(withoutAmbiguous, establishedPhase)
      : withoutAmbiguous;

  return { phase, ambiguousFallbackPhase: floored === phase ? null : floored };
};

export const getMaxTokensForPhase = (phase: ScenePhase): number => {
  switch (phase) {
    case "conversation":
      return 1024;
    case "intimate":
      return 1536;
    case "erotic":
      // 日本語1文字≈2トークン。長文指示(~1100字)+XML構造で2048では不足し途中切れする
      return 3072;
    case "climax":
      return 3584;
    case "afterglow":
      return 1536;
  }
};
