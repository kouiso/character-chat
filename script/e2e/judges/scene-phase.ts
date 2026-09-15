import type { Phase } from "../types";
import { AFTERGLOW_CUES } from "../../../src/lib/scene-phase";

export type PhaseJudgment = {
  detected: Phase;
  monotonicViolation: boolean;
  afterglowDetected: boolean;
  baseDetected?: Phase;
};

const PHASE_ORDER = {
  conversation: 0,
  intimate: 1,
  erotic: 2,
  climax: 3,
  afterglow: 4,
} as const;

export const AFTERGLOW_KEYWORDS = [
  ...AFTERGLOW_CUES,
  "事後",
  "余韻",
  "息が整う",
  "落ち着",
  "腕枕",
  "寝息",
  "抱きしめたまま",
  "甘え",
  "抜け出せない",
  "まどろみ",
  "すやすや",
  "抱きしめる",
  "胸に顔",
  "寄りかか",
  "立ち上が",
  "ふらつ",
  "足元",
  "支えられ",
  "支えて",
  "支え",
  "目を細め",
  "頬を赤らめ",
  "顔を埋めた",
  "鼓動を感じながら",
  "小さく微笑",
  "身体を拭き",
  "見られたい",
  "おやすみなさい",
  "体温に触れ",
  "鼓動が落ち着く",
  "心地よく目を閉じる",
  "心地よい疲労感",
  "腕に包まれ",
  "安心",
  "呼吸が落ち着",
  "呼吸が荒",
  "水を飲",
  "髪を整え",
  "髪を優しく整え",
  "手を軽く握",
  "心が温か",
  "安堵",
  "水を持ってくる",
  "思い出",
  "水を",
  "ぬくもり",
  "温もり",
  "安らぎ",
  "満足感",
  "静寂",
  "充実感",
  "穏やか",
  "呼吸を整",
  "余韻に浸",
  "香り",
  "匂い",
  "ガラス",
  "グラス",
  "コート",
  "外気",
  "寒い",
  "湯",
  "シャワー",
  "毛布",
  "ブランケット",
  "路地裏",
  "外に",
  "歩",
  "手を握",
  "連れ出",
  "窓",
  "繋いだ",
  "繋がっ",
] as const;

const AFTERGLOW_WINDOW_TURNS = 7;

const hasAfterglowCue = (assistantMsg: string): boolean =>
  AFTERGLOW_KEYWORDS.some((keyword) => assistantMsg.includes(keyword));

const HIRAGANA_IKU_ORGASM_CONTEXT =
  /(?:だめ|もう|限界|あっ|んっ|イクッ|いくっ|イッちゃ|達し|果て|絶頂|中に出|射精|びくびく|痙攣)/u;
const CLIMAX_PULSE_CONTEXT =
  /(?:中に出|射精|精液|膣内|子宮|絶頂|果て|痙攣|びくびく|満た|注ぎ込|奥)/u;
const NON_CLIMAX_PULSE_CONTEXT = /(?:心臓|鼓動|耳|脈|胸が高鳴|動悸)/u;

const hasGuardedHiraganaIkuCue = (assistantMsg: string): boolean => {
  let match: RegExpExecArray | null = null;
  const pattern = /いく/g;
  while ((match = pattern.exec(assistantMsg)) !== null) {
    const index = match.index;
    const previousCharacter = assistantMsg.at(index - 1) ?? "";
    if (previousCharacter === "て" || previousCharacter === "で") {
      continue;
    }

    const contextStart = Math.max(0, index - 12);
    const contextEnd = Math.min(assistantMsg.length, index + 12);
    const context = assistantMsg.slice(contextStart, contextEnd);
    const trailing = assistantMsg.slice(index + 2, index + 4);
    const leading = assistantMsg.slice(Math.max(0, index - 2), index);

    // 「動けないくらい」「行くし」「行くたび」など非絶頂語内の「いく」を除外。
    if (/^[らるした]/u.test(trailing)) {
      continue;
    }

    if (
      HIRAGANA_IKU_ORGASM_CONTEXT.test(context) ||
      /^[っッ…！!、。]/u.test(trailing) ||
      /[、。…！!]$/u.test(leading)
    ) {
      return true;
    }
  }
  return false;
};

const hasGuardedPulseCue = (assistantMsg: string): boolean => {
  let match: RegExpExecArray | null = null;
  const pattern = /(?:どくどく|ドクドク)/gu;
  while ((match = pattern.exec(assistantMsg)) !== null) {
    const index = match.index;
    const contextStart = Math.max(0, index - 24);
    const contextEnd = Math.min(assistantMsg.length, index + 24);
    const context = assistantMsg.slice(contextStart, contextEnd);
    if (CLIMAX_PULSE_CONTEXT.test(context) && !NON_CLIMAX_PULSE_CONTEXT.test(context)) {
      return true;
    }
  }
  return false;
};

// 中出し懇願（climax onset）。事後回想で「中に出して」が引用されるケースを
// 避けるため、近傍に「ほしい/頼/願/限界/もう/我慢」等の高まり語が必要。
const hasCreampieBeggingCue = (assistantMsg: string): boolean => {
  const pattern = /中に[^。！？\n]{0,16}出[しさせ]/gu;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(assistantMsg)) !== null) {
    const context = assistantMsg.slice(
      Math.max(0, match.index - 24),
      Math.min(assistantMsg.length, match.index + match[0].length + 24),
    );
    if (/(?:ほしい|頼|願|限界|もう|我慢|だめ|いっ|イッ)/u.test(context)) {
      return true;
    }
  }
  return false;
};

const hasCombinedClimaxCue = (assistantMsg: string): boolean =>
  /(?:膣内|子宮|中に出|射精)/u.test(assistantMsg) &&
  /(?:もう我慢できない|痙攣|びくびく|絶頂|果て|満た|理性の糸|限界|注いで)/u.test(assistantMsg);

const hasClimaxCue = (assistantMsg: string): boolean =>
  hasGuardedHiraganaIkuCue(assistantMsg) ||
  hasGuardedPulseCue(assistantMsg) ||
  hasCreampieBeggingCue(assistantMsg) ||
  hasCombinedClimaxCue(assistantMsg) ||
  [
    "イク",
    "イッ",
    "絶頂",
    "びくんと跳ね上がる",
    "奥深くから震え",
    "びくびく",
    "痙攣",
    "果て",
    "射精",
    "頭が真っ白",
    "一つになりたい",
    "震えが止まらない",
    "理性の糸が切れる",
    "子宮",
    "本当に限界",
    "もう限界",
    "我慢の限界",
  ].some((keyword) => assistantMsg.includes(keyword));

const hasKissOrLipActionCue = (assistantMsg: string): boolean =>
  /キス(?:を)?(?:する|した(?!く)|交わ|される|された)/u.test(assistantMsg) ||
  /唇[^。！？、,\n]{0,16}(?:触れ|重な|重ね|合わせ|近づ|寄せ|口づけ)|(?:触れ|重な|重ね|合わせ|近づ|寄せ)[^。！？、,\n]{0,16}唇/u.test(
    assistantMsg,
  );

// ── 性的文脈の共有語彙 ────────────────────────────────────────────────
// 「入れられ」「顔を埋め」「上に乗る」「跨が」「中へ入」「腰が動く」「内側の締めつけ」は
// どれも日常語としても使われる多義表現で、非性的な反例を1つずつ黒リストへ足す設計では
// 穴が埋まらない(「気合を入れられ」を除いても「限定品を手に入れられた」が残る)。
// そこで判定を反転させ、これらのアンカーは近傍に明示的な性的文脈語が在るときだけ
// erotic とする。語彙はこのファイルが既に性的として扱っている語だけで構成する
// (erotic キーワード配列 / CLIMAX_PULSE_CONTEXT / WET_AROUSAL_CONTEXT /
//  HIRAGANA_IKU_ORGASM_CONTEXT の喘ぎ語 / hasGenitalTighteningCue のアンカー語)。
// 「敏感」だけは既存語彙に無いが、実録の性行為描写で頻出し(2026-07-28実測の
// オーラル応答「そこは本当に…敏感なのに」)、他の語では拾えないため加える。ただし
// 素の「敏感」は「敏感肌」を巻き込むので、活用形(敏感な/敏感に/敏感すぎ)に限定する。
// 「彼のもの/熱いもの」は実録(sendfix-993-final)に在る性器の婉曲表現で、
// 「彼のものが中で脈打つ」「熱いものが子宮の奥に注がれ」のように主格・目的格で現れる。
// 「完全に彼のものになった」のような所有の言い回しを拾わないよう助詞が/をを必須にする。
//
// 「敏感な」からは「敏感な肌」を外す。素の「敏感」で「敏感肌」を外したのと同じ理由で、
// 「敏感な肌」は化粧品・皮膚科の言い回しであって性的文脈やない
// (「敏感な肌なので、診察予定を表に入れられた」が挿入描写として通っていた)。
// 「敏感な肌が震える」型の官能描写は取りこぼすが、その文には他の性的語がほぼ必ず
// 同居するのに対し、皮膚科の文には何も無いので、外す側の取りこぼしの方が小さい。
const SENSITIVE_INFLECTION = "敏感(?:な(?!肌)|に|すぎ)";

const UNAMBIGUOUS_SEXUAL_VOCABULARY = new RegExp(
  `(?:膣|子宮|結合部|秘部|割れ目|股間|乳首|愛液|精液|蜜が|蜜の|中に出|射精|挿入|指を入|ピストン|突き上げ|突き入れ|突かれ|腰を振|喘ぎ|んっ|イク|イッ|絶頂|果て|痙攣|びくびく|快感|疼く|身悶え|${SENSITIVE_INFLECTION}|(?:彼の|熱い|硬い)もの[がを])`,
  "u",
);

// 上の語彙を、窓の広さで二段に割る。
// 隣の文まで見る広い窓(80文字)が要るのは実測済みで、実録応答2件が「アンカーと同じ文には
// 何も無く、次の文の喘ぎ・形容だけが唯一の性的合図」という形をしているため
// (「こんな姿勢で入れられるなんて」を支える「…んっ…」、「太ももの内側に顔を埋められ」を
//  支える「敏感なのに」)。この2件は残す。
// 一方、解剖学的な名詞(股間/秘部/膣…)は診察・健康診断のような臨床的・日常的な文にも
// そのまま出るので、広い窓のままだと「健康診断で股間を診てもらった。自転車に跨がって帰った」の
// ように、前の文の名詞が次の文の警戒対象(跨が)を保証してしまう。
// よって「臨床・日常の文体では出てこない語(喘ぎ・体液・行為そのもの)」だけを文跨ぎで許し、
// 解剖学的名詞はアンカーと同じ文の中に在るときだけ文脈と認める。
const CROSS_SENTENCE_SEXUAL_VOCABULARY = new RegExp(
  `(?:愛液|精液|蜜が|蜜の|中に出|射精|挿入|指を入|ピストン|突き上げ|突き入れ|突かれ|腰を振|喘ぎ|んっ|イク|イッ|絶頂|果て|痙攣|びくびく|快感|疼く|身悶え|${SENSITIVE_INFLECTION}|(?:彼の|熱い|硬い)もの[がを])`,
  "u",
);

const SAME_SENTENCE_ANATOMY_VOCABULARY = /(?:膣|子宮|結合部|秘部|割れ目|股間|乳首)/u;

// 単独では日常語にもなる語。「馬に跨って草原を走る。太ももが筋肉痛だ」のように
// 隣の文へ出ただけのこれらを文脈と認めると、非性的な文をそのまま erotic へ巻き上げる。
// よってアンカーと同じ文の中に在るときだけ文脈として数える。
const AMBIGUOUS_SEXUAL_VOCABULARY =
  /(?:脚を開|舐め|吸い付|胸を弄|裸|下着|脱が|脱い|内腿|内もも|太もも|太腿)/u;

// 挿入(「入れられ」)を性的と認めるための文脈語は、上の曖昧語より更に狭くする。
// 衣類語(下着/脱が/脱い)と日常の身体部位語(太もも/内腿…)は「下着を洗濯機に入れられた」
// のような家事の文にそのまま出るため、これらだけを根拠に挿入と判定してはいけない。
// 残すのは行為そのものを指す語(脚を開/舐め/吸い付/胸を弄)と、行為中の裸体
// (「裸足」を巻き込まないよう否定先読みを付ける)。性器・喘ぎ・婉曲表現は
// UNAMBIGUOUS_SEXUAL_VOCABULARY 側で拾われるのでここには重ねない。
const PENETRATION_AMBIGUOUS_VOCABULARY = /(?:脚を開|舐め|吸い付|胸を弄|裸(?!足))/u;

// 実録応答での最遠ヒットが59文字だったため、余裕を持たせて80文字とする。
const SEXUAL_CONTEXT_WINDOW = 80;

const SENTENCE_BOUNDARY = /[。！？\n]/u;

const sentenceStartIndex = (text: string, index: number): number => {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (SENTENCE_BOUNDARY.test(text[i] ?? "")) {
      return i + 1;
    }
  }
  return 0;
};

const sentenceEndIndex = (text: string, index: number): number => {
  for (let i = index; i < text.length; i += 1) {
    if (SENTENCE_BOUNDARY.test(text[i] ?? "")) {
      return i;
    }
  }
  return text.length;
};

// マッチした文字列そのものは文脈から除く。除かないと「太ももに顔を埋めて泣く」のように
// アンカー語(太もも)が自分自身の文脈判定を満たしてしまい、ガードが素通りになる。
//
// 窓の取り方は語の曖昧さで二段にする。実録応答では性的文脈語が別の文(地の文の次の文や
// 直後の台詞「んっ…」)に落ちるのが普通で、窓を同一文へ完全に閉じると
// 「こんな姿勢で入れられるなんて」「太ももの内側に顔を埋められ」の実録 positive が
// 両方 intimate へ落ちる(実測で確認)。一方、同一文への閉じ込めを一切しないと
// 「馬に跨って草原を走る。太ももが筋肉痛だ」が erotic になる。
// 誤検出の元は常に曖昧語(太もも等)側なので、曖昧語だけ同一文に閉じ、
// 単独で性的な語は従来どおり前後80文字を見る。
const hasSexualContextNear = (
  text: string,
  matchIndex: number,
  matchLength: number,
  ambiguousVocabulary: RegExp = AMBIGUOUS_SEXUAL_VOCABULARY,
  windowChars: number = SEXUAL_CONTEXT_WINDOW,
): boolean => {
  const matchEnd = matchIndex + matchLength;
  const before = text.slice(Math.max(0, matchIndex - windowChars), matchIndex);
  const after = text.slice(matchEnd, matchEnd + windowChars);
  if (
    CROSS_SENTENCE_SEXUAL_VOCABULARY.test(before) ||
    CROSS_SENTENCE_SEXUAL_VOCABULARY.test(after)
  ) {
    return true;
  }

  const sentenceBefore = text.slice(
    Math.max(sentenceStartIndex(text, matchIndex), matchIndex - windowChars),
    matchIndex,
  );
  const sentenceAfter = text.slice(
    matchEnd,
    Math.min(sentenceEndIndex(text, matchEnd), matchEnd + windowChars),
  );
  // 解剖学的名詞は同一文に閉じる。曖昧語(太もも等)と同じ扱いになるが、理由は別で、
  // 曖昧語は語自体が非性的な意味を持つのに対し、こちらは語の意味は性的でも
  // 臨床・日常の文に出るため、隣の文の警戒対象を保証する力までは持たせられない。
  const sameSentenceVocabulary = new RegExp(
    `${SAME_SENTENCE_ANATOMY_VOCABULARY.source}|${ambiguousVocabulary.source}`,
    "u",
  );
  return sameSentenceVocabulary.test(sentenceBefore) || sameSentenceVocabulary.test(sentenceAfter);
};

// アンカーの全出現を走査し、除外条件に当たらず、かつ近傍に性的文脈が在るものが
// 1つでもあれば true。ガード群はすべてこの1本を経由させ、設計をそろえる。
const hasSexuallyContextualizedMatch = (
  assistantMsg: string,
  pattern: RegExp,
  options: {
    isNonSexualMatch?: (match: RegExpExecArray, assistantMsg: string) => boolean;
    ambiguousVocabulary?: RegExp;
  } = {},
): boolean => {
  const { isNonSexualMatch, ambiguousVocabulary } = options;
  const scanner = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let match: RegExpExecArray | null = null;
  while ((match = scanner.exec(assistantMsg)) !== null) {
    if (isNonSexualMatch?.(match, assistantMsg)) {
      continue;
    }
    // マッチ範囲そのものが曖昧さの無い性器語(股間/秘部/膣…)を含むなら、それだけで
    // 性行為の描写として成立する。文脈探索はマッチ範囲を除外する設計なので、
    // 除外しないと「顔を彼女の股間に埋める」の股間が捨てられ、外側に何も無い短い文が
    // 素通りしていた(アンカーが自分自身を保証するのを防ぐ元の意図は、曖昧語にだけ効けばよい)。
    if (UNAMBIGUOUS_SEXUAL_VOCABULARY.test(match[0])) {
      return true;
    }
    if (hasSexualContextNear(assistantMsg, match.index, match[0].length, ambiguousVocabulary)) {
      return true;
    }
  }
  return false;
};

// ── 名詞クラス辞書 ──────────────────────────────────────────────────
// 「中」の持ち主、跨ぐ相手、締めつける主体の持ち主 — この3つはどれも同じ一つの問いに
// 帰着する: その名詞は人か、場所か、物か。
// 以前はアンカーごとに別々の除外リストを持っていた(場所の列挙 / 非人間の乗り物の列挙 /
// 締めつけの lookbehind 列挙)。列挙は「人でないもの」を数え切ろうとする形なので、
// リストに無い名詞が出るたびに同じ穴が開く — 病院(場所)・丸太と遊具(物)・靴と手袋(衣類)は
// 全部その穴やった。列挙を足す代わりに分類器を1本にまとめ、全アンカーをここへ通す。
//
// クラスを引けん語(unknown)の既定はアンカーごとに変える。人名だけは有限に数え上げられん
// のに対し、場所・物・抽象は数え上げられる、という非対称性があり、その非対称性が効く位置
// (「〜の中に入る」の持ち主)と効かん位置(締めつけの持ち主)で安全な既定が逆になるため。
// 既定の理由は各アンカーのコメントに書く。
type NounClass =
  | "person"
  | "sexual-interior"
  | "body-part"
  | "place"
  | "object"
  | "abstract"
  | "unknown";

// 人称・敬称・続柄。敬称は名前の後ろに付くので、名前そのものを列挙せんでも人と判る。
const PERSON_ISH_PATTERN =
  /(?:あなた|貴女|貴方|君|きみ|お前|おまえ|彼女|彼|私|わたし|あたし|僕|ぼく|俺|おれ|自分|お互い|二人|ふたり|相手|さん|ちゃん|くん|様|先生|先輩|後輩|母|父|姉|妹|兄|弟|嫁|妻|夫|恋人|彼氏|女|男)$/u;

// 性器・体内。締めつけでも挿入でも、これが持ち主なら性的描写で確定する。
const SEXUAL_INTERIOR_PATTERN = /(?:膣内|膣|子宮|胎内|結合部|秘部)$/u;

// 性的でない身体部位。「喉の内側」「胸の奥」は締めつけの誤検出源やが、
// 「身体の中に入る」「お腹の中」は挿入・体内を指すので、アンカー側で扱いを分ける。
const BODY_PART_PATTERN =
  /(?:身体|体|お腹|腹|喉|喉元|胸|心臓|肺|頭|眉間|奥歯|こめかみ|鼻|目|耳|肩|背中|腕|足|脚|手|指|首|顎|瞼|唇|舌|肌|皮膚|筋肉|全身|膝)$/u;

// 入る対象になる空間。
const PLACE_ISH_PATTERN =
  /(?:店|部屋|室|家|宅|館|荘|寮|ビル|建物|駅|校|園|場|所|病院|医院|院|クリニック|診療所|廊下|玄関|階段|会場|ホテル|旅館|温泉|銭湯|倉庫|庫|道|路地|トンネル|洞窟|茂み|草むら|畑|庭|寺|神社|市場|施設|オフィス|工場|空港|港|島|湖|池|谷|町|村|市|県|国|車|バス|電車|タクシー|船|飛行機|エレベーター|風呂|浴室|サウナ|トイレ|ロッカー|クローゼット|テント|森|林|山|海|川|プール|穴|水|霧|闇|人混み|群衆|列|行列)$/u;

// 身に着ける物・容れ物・家具・乗り物・動物・道具。跨ぐ相手にも、締めつける主体の
// 持ち主にもなる。
const OBJECT_ISH_PATTERN =
  /(?:靴|ブーツ|サンダル|スリッパ|靴下|手袋|グローブ|服|衣服|シャツ|ブラウス|ズボン|スカート|コート|上着|ジャケット|袖|襟|ポケット|帽子|マスク|指輪|下着|箱|袋|鞄|バッグ|財布|缶|瓶|ボトル|コップ|皿|鍋|引き出し|棚|冷蔵庫|洗濯機|机|テーブル|椅子|イス|ソファ|ベンチ|台|柵|塀|岩|石|手すり|バランスボール|丸太|遊具|ブランコ|滑り台|梯子|はしご|脚立|木|枝|馬|ポニー|牛|犬|猫|自転車|バイク|オートバイ|ハンモック|布団|ベッド|枕|クッション|タオル|毛布|シーツ)$/u;

// 物理的な入れ物やない「中」の持ち主。「心の中」「夢の中」「予定の中」。
// 指示語(その/この)は「その中に入る」で持ち主が1文字だけ残るため、語頭の
// こ/そ/あ/ど だけを指示語として拾う(名前の末尾の「あ」を巻き込まんよう、
// 直前が仮名・漢字でない場合に限る)。
const ABSTRACT_ISH_PATTERN =
  /(?:心|夢|話|物語|記憶|写真|画面|映像|世界|予定|表|枠|範囲|リスト|名簿|グループ|チーム|文章|本|資料|データ|空気|雰囲気|流れ|音|光|時間|人生|関係|会話|議論|計画|作品|作業|過程|順番|順位|(?:^|[^ぁ-んァ-ヶ一-龯])[こそあど])$/u;

const classifyNoun = (tail: string): NounClass => {
  if (SEXUAL_INTERIOR_PATTERN.test(tail)) {
    return "sexual-interior";
  }
  if (PERSON_ISH_PATTERN.test(tail)) {
    return "person";
  }
  if (BODY_PART_PATTERN.test(tail)) {
    return "body-part";
  }
  if (PLACE_ISH_PATTERN.test(tail)) {
    return "place";
  }
  if (OBJECT_ISH_PATTERN.test(tail)) {
    return "object";
  }
  if (ABSTRACT_ISH_PATTERN.test(tail)) {
    return "abstract";
  }
  return "unknown";
};

// 「内側」は結合部の締めつけ描写で頻出するが従来アンカーに無く、
// 「内側で熱い締めつけがあなたを包む」(2026-07-28実測)が intimate 止まりになっていた。
//
// アンカーは曖昧さで二分する。膣/膣内/子宮/結合部 は他の意味を持たないので
// 「膣が強く締めつける」だけで性行為の描写として成立し、外側の文脈語を要求すると
// 逆に取りこぼす。中/奥/内側 は「胸の内側が締めつけられる」「喉の内側が…」のように
// 非性的な描写と同形なので、こちらだけ性的文脈の近接を必須にする
// (「胸の内側」「心の内側」の lookbehind 除外も併用する)。
const UNAMBIGUOUS_GENITAL_TIGHTENING_PATTERN =
  /(?:膣内|膣|子宮|結合部)[^。！？\n]{0,24}締めつけ|締めつけ[^。！？\n]{0,24}(?:膣内|膣|子宮|結合部)/u;

const AMBIGUOUS_GENITAL_TIGHTENING_PATTERN =
  /(?:中|奥|(?<!胸の)(?<!心の)内側)[^。！？\n]{0,24}締めつけ|締めつけ[^。！？\n]{0,24}(?:中|奥|(?<!胸の)(?<!心の)内側)/u;

// 「中が強く締めつける」のように主語が裸の「中/奥/内側」で、しかも「が」で受ける形は
// 結合部の締めつけ以外の意味を持たない婉曲表現で、実際の応答では第二のキーワードを
// 伴わずに単独で出る。非性的な誤検出は逆に必ず持ち主が前に付く形
// (「喉の内側が」「靴の内側が」)を取る。
//
// 以前はその持ち主を否定後読みの列挙(喉|胸|心|お腹…)で落としていたが、列挙に無い
// 持ち主 — 靴・手袋のような衣類 — がそのまま通っていた(「靴の内側が足を強く締めつける」)。
// 持ち主が書かれとるなら分類器へ通す。
//
// この位置の unknown は erotic にせん。「〜の中に入る」と逆の既定にする理由は、
// ここで持ち主が人である場合、実際の応答は人称語(「彼女の中が」)か裸の主語で書かれ、
// キャラ名を持ち主に立てる形(「みつきの内側が締めつける」)が出てこんため。
// 未知の持ち主はほぼ衣類・容器・身体部位側に落ちる。
const INNER_TIGHTENING_SUBJECT_PATTERN = /(?:中|奥|内側)が[^。！？、\n]{0,12}締めつけ/u;

const hasOwnerlessInnerTighteningCue = (assistantMsg: string): boolean => {
  const scanner = new RegExp(INNER_TIGHTENING_SUBJECT_PATTERN.source, "gu");
  let match: RegExpExecArray | null = null;
  while ((match = scanner.exec(assistantMsg)) !== null) {
    const preceding = assistantMsg.slice(Math.max(0, match.index - 10), match.index);
    if (!preceding.endsWith("の")) {
      return true;
    }
    const ownerClass = classifyNoun(preceding.slice(0, -1));
    if (ownerClass === "person" || ownerClass === "sexual-interior") {
      return true;
    }
  }
  return false;
};

const hasGenitalTighteningCue = (assistantMsg: string): boolean =>
  UNAMBIGUOUS_GENITAL_TIGHTENING_PATTERN.test(assistantMsg) ||
  hasOwnerlessInnerTighteningCue(assistantMsg) ||
  hasSexuallyContextualizedMatch(assistantMsg, AMBIGUOUS_GENITAL_TIGHTENING_PATTERN);

// 受け身の挿入描写は「挿入」「中に入」「指を入」のどれにも当たらず intimate 止まりになる
// (2026-07-28実測:「こんな姿勢で入れられるなんて」)。「気合を入れられ」型の目的語除外は
// 残すが、目的語を列挙する方式では「限定品を手に入れられた」「予定に入れられて」を
// 塞げないので、性的文脈の近接を必須条件として重ねる。
const NON_SEXUAL_INSERT_OBJECT = /(?:気合|力|メス|電源|茶|コーヒー|保険|念|活|ヒビ|亀裂)を?$/u;

// 「彼のもの/熱いもの/硬いもの」は性器の婉曲表現として CROSS_SENTENCE_SEXUAL_VOCABULARY に
// 登録済みだが、この語彙は「もの」を主語に持つ文なら何でも文脈として拾ってしまう。
// 「硬いものがケースに入れられた」「熱いものが冷蔵庫に入れられた」
// 「彼のものが段ボール箱に入れられた」は宅配・収納の描写で、行き先が
// 容器(ケース/冷蔵庫/箱)であって身体や性器やない。婉曲表現そのものを狭める代わりに、
// 「入れられ」の直前が容器語なら既存の非性的対象と同じ扱いで除外する
// (NON_SEXUAL_INSERT_OBJECT と同じ設計: 目的語側の除外を重ねる)。
const NON_SEXUAL_INSERT_CONTAINER =
  /(?:ケース|冷蔵庫|段ボール箱|箱|棚|引き出し|バッグ|かばん|カバン|ポケット)に$/u;

// 「受け入れられ」「手に入れられ」のような複合動詞は目的語の除外では止まらない
// (「裸の自分を受け入れられて、ほっとした」は同じ文に性的文脈語の「裸」が在るため
// 文脈条件を満たしてしまう)。複合動詞の前項そのものを除外する。
const NON_SEXUAL_INSERT_COMPOUND =
  /(?:受け|受|取り|申し|聞き|迎え|招き|組み|仕|差し|引き|挟み|借り|請け|付け|運び|手に)$/u;

// 文脈語は PENETRATION_AMBIGUOUS_VOCABULARY に絞る。衣類語を許すと
// 「下着を洗濯機に入れられた」が挿入描写として通ってしまうため。
const hasPassivePenetrationCue = (assistantMsg: string): boolean =>
  hasSexuallyContextualizedMatch(assistantMsg, /入れられ/u, {
    isNonSexualMatch: (match, text) => {
      // 容器語(段ボール箱など)は6文字を超えるため、この判定だけ窓を広げる。
      const preceding = text.slice(Math.max(0, match.index - 8), match.index);
      return (
        NON_SEXUAL_INSERT_OBJECT.test(preceding) ||
        NON_SEXUAL_INSERT_COMPOUND.test(preceding) ||
        NON_SEXUAL_INSERT_CONTAINER.test(preceding)
      );
    },
    ambiguousVocabulary: PENETRATION_AMBIGUOUS_VOCABULARY,
  });

// 「中に入」「中へ入」は「店の中へ入る」「部屋の中に入る」と同形で、無条件語のままでは
// 移動描写を erotic に巻き上げる。一方で、追加語彙を要求すると本番プロンプトで確立済みの
// 挿入表現(script/model-ab-test.ts の「ゆっくりみつきの中に入っていく」
// 「ゆっくりあずさの中に入る」)が conversation へ落ちる。どちらの穴も語を足し引きしても
// 埋まらないので、判定軸を「中」の持ち主に移し、分類器へ通す。
//
// 判定は持ち主の有無で二段。
// (1) 持ち主が書かれとる(「〜の中に入る」)なら、そのクラスで決める。
//     人・体内なら挿入、場所・物・抽象なら移動で、移動と判った時点でこの出現は
//     打ち切る — 文脈語を見に行かせん。見に行かせると「股間を押さえながら病院の中へ入る」の
//     ように、同じ文の解剖学的名詞が「場所へ入る」を挿入として保証してしまう。
// (2) 持ち主が書かれてへん(「彼のものがゆっくり中に入ってくる」)なら従来どおり文脈で拾う。
//     文脈語は PENETRATION_AMBIGUOUS_VOCABULARY に絞る。衣類語(脱が/脱い/下着)を許すと
//     「服を脱いで浴室の中に入る」のような入浴・着替えの描写が挿入として通ってしまうため。
//
// この位置に限り、unknown の持ち主は人として扱う。場所・物・抽象は数え上げられるが
// 人名は数え上げられん、という非対称性がここでは効くため — 本番プロンプトの
// 「ゆっくりみつきの中に入っていく」は呼びかけも人称も伴わん裸のキャラ名で、
// 第二の合図が一切無い。ただし「名前らしい字種」であることは要求する。助詞・記号・数字を
// 含む断片は名前になれんので、そこまで崩れた持ち主は人と見なさず文脈判定へ落とす。
const NAME_SHAPED_POSSESSOR = /[ぁ-んァ-ヶー一-龯々]{2,}$/u;

const ENTRY_PERSON_CLASSES: ReadonlySet<NounClass> = new Set([
  "person",
  "sexual-interior",
  // 「身体の中に入る」「お腹の中で」は体内を指す。喉・胸のような他の部位も同じ扱いに
  // なるが、「喉の中に入る」型の非性的な文は実運用の応答に出てこん。
  "body-part",
]);

const hasEnteringInsideCue = (assistantMsg: string): boolean => {
  const pattern = /中[にへ]入/gu;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(assistantMsg)) !== null) {
    const preceding = assistantMsg.slice(Math.max(0, match.index - 10), match.index);
    if (preceding.endsWith("の")) {
      const possessor = preceding.slice(0, -1);
      const possessorClass = classifyNoun(possessor);
      if (ENTRY_PERSON_CLASSES.has(possessorClass)) {
        return true;
      }
      if (possessorClass !== "unknown") {
        continue;
      }
      if (NAME_SHAPED_POSSESSOR.test(possessor)) {
        return true;
      }
    }
    if (
      hasSexualContextNear(
        assistantMsg,
        match.index,
        match[0].length,
        PENETRATION_AMBIGUOUS_VOCABULARY,
      )
    ) {
      return true;
    }
  }
  return false;
};

// オーラルセックス描写に該当語が1つも無く、「太もも」だけ拾って intimate 止まりになる
// (2026-07-28実測:「太ももの内側に顔を埋められ…そこは本当に…敏感なのに」)。
// 下半身のアンカー語が近いだけでは「太ももに顔を埋めて泣く」も通ってしまうので、
// マッチ範囲の外に性的文脈語が在ることを追加条件にする。
// 「顔を彼女の股間に埋め」のように行き先が「顔を」と「埋め」の間へ入る語順が能動文では
// 自然だが、前2つの並びでは拾えない。3つ目の並びとして許す。
const ORAL_SEX_PATTERN =
  /(?:太もも|太腿|内もも|内腿|脚の間|股間|秘部|割れ目)[^。！？\n]{0,24}顔を埋め|顔を埋め[^。！？\n]{0,24}(?:太もも|太腿|内もも|内腿|脚の間|股間|秘部|割れ目)|顔を[^。！？\n]{0,16}(?:太もも|太腿|内もも|内腿|脚の間|股間|秘部|割れ目)[^。！？\n]{0,8}埋め/u;

const hasOralSexCue = (assistantMsg: string): boolean =>
  hasSexuallyContextualizedMatch(assistantMsg, ORAL_SEX_PATTERN);

// 騎乗位の描写が「跨が」を使わず「上に乗る」で書かれると、既存語では拾えず
// intimate 止まりになる(2026-07-28実測:「朔がゆっくりと上に乗り、腰があなたの太ももに沈む」)。
// 「腰」の近接だけでは「馬の上に乗ると腰が痛くなる」を通してしまい、無条件語だった
// 「跨が」「跨っ」「馬乗り」は自転車・乗馬の描写をそのまま erotic にしていた。
// どちらも同じ穴なので、まとめて性的文脈の近接を必須にする。
const STRADDLE_PATTERN = /上に乗[^。！？\n]{0,16}腰|腰[^。！？\n]{0,16}上に乗|跨が|跨っ|馬乗り/u;

// 跨る動作に「身体・腰を沈める/下ろす」が続く形は騎乗位の挿入描写そのもので、
// 実録応答では周囲に他の性的語が無いまま出る(「健太の上に跨がり、ゆっくりと身体を沈めていく」)。
// 乗馬・自転車の描写(「馬に跨って草原を走る」)は跨ったあとに走る・向かうで、身体を沈める
// 動作を伴わないため、この組み合わせだけを外側の文脈語なしで erotic と認める。
// 「夕日が沈む」を巻き込まないよう、沈む主体(腰/身体/尻)を明示的に挟ませる。
//
// 「上に乗」はこの無条件経路から外す。跨ぐ動作と違い、台や椅子の上に立って身体を下ろすのは
// ただの日常動作で(「椅子の上に乗り、身体をゆっくり下ろした」)、乗る対象が人か家具かを
// この形だけでは区別できないため。人の上に乗る実録応答(S8 turn 7
// 「上に乗り、腰があなたの太ももに沈む」)は、同じ文に在る身体部位(太もも)を文脈語として
// STRADDLE_PATTERN 側で拾えるので、無条件経路から外しても取りこぼさない。
const STRADDLE_LOWERING_PATTERN =
  /(?:跨が|跨っ)[^。！？\n]{0,24}(?:腰|身体|体|尻|臀部)[^。！？\n]{0,12}(?:沈め|沈み|沈む|下ろし|下ろす|落とし)/u;

// 跨る対象が乗り物・動物・家具なら、身体を下ろす動作が続いても日常描写のまま
// (「自転車に跨がり、腰を下ろした」)。跨る対象が人である場合だけ無条件経路を通す。
//
// 以前は「人でない乗り物・家具」を列挙して除外していたが、列挙に無い物 — 丸太・遊具 —
// がそのまま騎乗位として通っていた。人でないものを数え切るのは無理なので条件を反転し、
// 「人の上に乗る形」だけを無条件経路に残す。手掛かりは格の取り方で、物・乗り物は
// 「自転車に跨がる」「丸太に跨がる」と直接「に」を取るのに対し、人を相手にする時は
// 「〜の上に跨がる」と身体の上を明示する(実録の「健太の上に跨がり…身体を沈めていく」)。
// 「岩の上に跨がり」のように物が「の上」を取る場合は分類器で落とす。
// 「〜の上」の持ち主が unknown なら人として通す — 「〜の中に入る」と同じ非対称性
// (人名は数え上げられん)がここでも効くため。
// 人相手でも「彼に跨がり」と直接「に」を取る書き方は無条件経路から外れるが、
// その場合は周囲の性的語で hasSexuallyContextualizedMatch 側が拾う。
const MOUNTED_OWNER_PATTERN = /(.{0,8})の上[にへ]$/u;

const hasStraddleLoweringCue = (assistantMsg: string): boolean => {
  const scanner = new RegExp(STRADDLE_LOWERING_PATTERN.source, "gu");
  let match: RegExpExecArray | null = null;
  while ((match = scanner.exec(assistantMsg)) !== null) {
    const preceding = assistantMsg.slice(Math.max(0, match.index - 10), match.index);
    const mounted = MOUNTED_OWNER_PATTERN.exec(preceding);
    if (mounted === null) {
      continue;
    }
    const ownerClass = classifyNoun(mounted[1] ?? "");
    if (ownerClass === "place" || ownerClass === "object" || ownerClass === "abstract") {
      continue;
    }
    return true;
  }
  return false;
};

const hasStraddleCue = (assistantMsg: string): boolean =>
  hasStraddleLoweringCue(assistantMsg) ||
  hasSexuallyContextualizedMatch(assistantMsg, STRADDLE_PATTERN);

// 「腰が動」は substring 一致のため、副詞が挟まる「腰がゆっくりと動き」を拾えない
// (2026-07-28実測)。「腰が痛くて動けない」を巻き込まないよう活用形を限定したうえで、
// 「ダンスで腰が滑らかに動き」のような非性的な体動と分けるため文脈を必須にする。
const WAIST_MOTION_PATTERN = /腰が[^。！？、\n]{0,8}動(?:く|き|い|かす|かし)/u;

const hasWaistMotionCue = (assistantMsg: string): boolean =>
  hasSexuallyContextualizedMatch(assistantMsg, WAIST_MOTION_PATTERN);

// 「奥まで」は「心の奥まで」「胸の奥まで」等、比喩的な深い場所を指すこともある。
// 性的文脈（膣/子宮/挿入/突く等）が近くにある場合のみ erotic とする。
const DEEP_PENETRATION_PATTERN = /(?<!心の)(?<!胸の)(?<!頭の)奥まで/u;
const hasDeepPenetrationCue = (assistantMsg: string): boolean =>
  hasSexuallyContextualizedMatch(assistantMsg, DEEP_PENETRATION_PATTERN);

// 「濡れ(て/た/る)」は愛液等の官能描写にも、雨天描写(「濡れたスカートの裾」等)にも出る多義語。
// 単純substring一致だと雨シーンを erotic に誤判定する(2026-07-16実測: S10 turn4/5)。
// 近傍(前後20字)に性的文脈語があり、かつ雨天語が無い場合のみ erotic 相当とする。
const WET_AROUSAL_CONTEXT = /(?:愛液|膣内|秘部|下着|肌が|太もも|内腿|下半身|蜜が|蜜の)/u;
const WET_WEATHER_CONTEXT = /(?:雨が|雨の|傘を|天気|降っ|濡れたスカートの裾|濡れた肌が冷え)/u;

const hasWetArousalCue = (assistantMsg: string): boolean => {
  let match: RegExpExecArray | null = null;
  const pattern = /濡れ(?:て|た|る)/gu;
  while ((match = pattern.exec(assistantMsg)) !== null) {
    const index = match.index;
    const contextStart = Math.max(0, index - 20);
    const contextEnd = Math.min(assistantMsg.length, index + 20);
    const context = assistantMsg.slice(contextStart, contextEnd);
    if (WET_AROUSAL_CONTEXT.test(context) && !WET_WEATHER_CONTEXT.test(context)) {
      return true;
    }
  }
  return false;
};

const ASSISTANT_PHASE_KEYWORDS: Array<{
  phase: Exclude<Phase, "conversation" | "afterglow" | "climax">;
  keywords: readonly string[];
}> = [
  {
    phase: "erotic",
    keywords: [
      "挿入",
      "指を入",
      // 「中に入」「中へ入」は hasEnteringInsideCue、「跨が」「跨っ」「馬乗り」は
      // hasStraddleCue へ移した。無条件語のままでは「店の中へ入る」「馬に跨って走る」を
      // erotic に誤判定するため、性的文脈の近接を要求するガード側で扱う。
      "愛液",
      "脚を開かれ",
      "突き",
      "激しい突",
      "喘ぎ声",
      "喘ぎ",
      "あえ",
      "腰を振",
      "腰が動",
      "腰が勝手に動",
      "ピストン",
      "指に反応",
      "指先の刺激",
      "彼の指を求め",
      "自身の腰をつかむ",
      "一気に貫かれ",
      "腰がくねる",
      "腰が自然と揺ら",
      "快感に",
      "身悶え",
      "疼く",
      "指が這う",
      "乳首",
    ],
  },
  {
    phase: "intimate",
    keywords: [
      "キスを",
      "首筋",
      "触れる",
      "触れた",
      "触られたい",
      "触られる",
      "触ってほしい",
      "寄り添う",
      "距離が詰",
      "距離がぐっと近",
      "首元",
      "顔が近づき",
      "顔が近づく",
      "顔を埋める",
      "擦り合わ",
      "脚を擦",
      "擦り寄せ",
      "息遣いが混ざり合う",
      "舐め",
      "吸い付",
      "横顔をチラリと見つめる",
      // ツンデレ的な「本音を隠す」内面描写。建前の否定台詞＋身体反応というパターンは
      // 露骨な接触語を伴わないため、これが無いと intimate 相当の応答が conversation に
      // 誤判定される(2026-07-16実測: S9 turn2/5)。
      // 「鼓動が」「心臓の音が」「胸が熱くな」「胸が高鳴」等の単純な心拍・興奮語は
      // 既存テスト(「心臓や鼓動のドクドクではclimax誤判定しない」)や実測（試合・プレゼン等
      // 非ロマンティックな緊張・興奮でも頻出）で偽陽性が確認されたため単独キーワードには
      // 含めない。特定の相手への身体的近さ・秘めた感情を明示する、より具体的な表現だけを
      // 対象にする。
      "温もりに包まれ",
      "体温が伝わ",
      "体温を感じる距離",
      "絶対に言えない",
      "絶対に口に出せない",
      "素直に言えない",
      "素直に伝えられない",
      "密かな期待",
      "ボタン",
      "ブラウス",
      "白衣が",
      "診察台",
      "下着",
      "脱が",
      "脱い",
      "裸",
      "スカート",
      "太腿",
      "太もも",
      "体を這う",
    ],
  },
];

export const detectAssistantScenePhase = (assistantMsg: string): Exclude<Phase, "afterglow"> => {
  if (hasClimaxCue(assistantMsg)) {
    return "climax";
  }

  for (const { phase, keywords } of ASSISTANT_PHASE_KEYWORDS) {

    if (phase === "erotic" && hasGenitalTighteningCue(assistantMsg)) {
      return phase;
    }
    if (phase === "erotic" && hasWetArousalCue(assistantMsg)) return phase;
    if (phase === "erotic" && hasPassivePenetrationCue(assistantMsg)) return phase;
    if (phase === "erotic" && hasEnteringInsideCue(assistantMsg)) return phase;
    if (phase === "erotic" && hasOralSexCue(assistantMsg)) return phase;
    if (phase === "erotic" && hasStraddleCue(assistantMsg)) return phase;
    if (phase === "erotic" && hasWaistMotionCue(assistantMsg)) return phase;
    if (phase === "erotic" && hasDeepPenetrationCue(assistantMsg)) return phase;
    if (phase === "intimate" && hasKissOrLipActionCue(assistantMsg)) return phase;
    if (keywords.some((keyword) => assistantMsg.includes(keyword))) {
      return phase;
    }
  }
  return "conversation";
};

// judgePhase本体と、LLMがdetectedを事後的に上書きするjudgePhaseWithLlm
// (scene-phase-llm.ts)の両方から使う共通ロジック。judgePhase内では
// detected!=="conversation"の前提で計算されるため、呼び出し側がdetectedを
// 後から書き換える場合はこの関数で単調性違反を再計算しなければならない
// (2026-07-16 Devin/Codex connector 指摘: 上書き後に再計算していなかった)。
export const computeMonotonicViolation = (
  previousPhase: Phase | null,
  detected: Phase,
  assistantMsg: string,
): boolean => {
  const rawMonotonicViolation =
    previousPhase !== null &&
    detected !== "conversation" &&
    PHASE_ORDER[previousPhase] > PHASE_ORDER[detected];
  const isLegitimateAfterglowDemotion =
    previousPhase !== null &&
    (previousPhase === "climax" || previousPhase === "afterglow") &&
    (detected === "conversation" || detected === "intimate" || detected === "afterglow") &&
    hasAfterglowCue(assistantMsg);
  return isLegitimateAfterglowDemotion ? false : rawMonotonicViolation;
};

export function judgePhase(args: {
  assistantMsg: string;
  expectedPhase: Phase;
  previousDetected: Phase | null;
  recentDetected?: Phase[];
}): PhaseJudgment {
  void args.expectedPhase;

  const recentDetected = args.recentDetected?.slice(-AFTERGLOW_WINDOW_TURNS) ?? [];
  const recentWindow = [args.previousDetected, ...recentDetected].filter(
    (phase): phase is Phase => phase !== null,
  );
  const hadRecentClimax = recentWindow.slice(-AFTERGLOW_WINDOW_TURNS).includes("climax");
  const baseDetected = detectAssistantScenePhase(args.assistantMsg);
  // afterglow 判定は、明示的なエロ・クライマックス表現が既にある場合は上書きしない。
  // 汗ばんだ/温もり等の afterglow キーワードは erotic フェーズでも自然に出るため。
  const afterglowDetected =
    baseDetected !== "climax" &&
    baseDetected !== "erotic" &&
    hadRecentClimax &&
    hasAfterglowCue(args.assistantMsg);
  const detected: Phase = afterglowDetected ? "afterglow" : baseDetected;
  const monotonicViolation = computeMonotonicViolation(args.previousDetected, detected, args.assistantMsg);

  return {
    detected,
    monotonicViolation,
    afterglowDetected,
    baseDetected,
  };
}
