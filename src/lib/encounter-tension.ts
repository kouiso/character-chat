// 出会って間もない関係性のキャラに対して、初対面特有の緊張感を描写指示として付け足す
// キャラ設定に無い枠は足さない。詳細は prompt/instructions/no-injected-ai-filter.md 参照

// キャラの【シナリオ】【関係性】がこの語を含む場合のみ、初対面向けの緊張描写を追加する
// character-generator.ts の SITUATION_PRESETS 由来の表現をカバーしつつ、
// 「幼馴染」「同僚」「夫婦」等の既存関係とは重ならない語だけを選んでいる
// 「偶然」単独は入れん。character-generator.ts の SITUATION_PRESETS にある
// 「偶然の再会」は、以前から知り合いだった相手との再会（＝既存関係）を指しとって、
// 初対面の緊張とは逆の意味になる。「結婚して5年、偶然バーで再会した」のような
// 既存関係のシナリオまで誤って初対面扱いする（敵対レビュー #1236 指摘）。
// 「飲み会」も単独では入れん。SITUATION_PRESETS の実際の文言は「飲み会で隣になった」で、
// 見知らぬ相手と偶然隣り合った場面を指す。単独の「飲み会」だと「結婚して5年の夫婦が
// 飲み会の帰りに」のような既存関係のシナリオまで拾ってしまう（敵対レビュー #1236 指摘）。
export const ENCOUNTER_STRANGER_KEYWORDS: readonly string[] = [
  "ナンパ",
  "声をかけ",
  "声をかけら",
  "マッチングアプリ",
  "飲み会で隣になっ",
  "深夜のコンビニ",
  "SNSのDM",
  "SNSで",
  "初対面",
  "今日会ったばかり",
  "出会ったばかり",
  "知り合ったばかり",
  "通りすがり",
] as const;

// relationship に既存関係を表す語があれば、scenario 側に出会い方の記述（マッチングアプリ等）が
// 残っとっても初対面扱いにしない。scenario は出会った経緯の記述、relationship は現在の関係を
// 表す別フィールドなので、「マッチングアプリで出会った」→「結婚して5年の夫婦」のように両立する
// キャラ設定が存在する（character-generator.ts の SITUATION_PRESETS とLLM生成のrelationship
// は独立している）。この場合、現在の関係を表すrelationshipを優先する（敵対レビュー #1236 指摘4巡目）。
// src/data/scene-cards.ts の relationship フィールドで実際に使われとる語を含める
// （敵対レビュー #1236 指摘・6巡目: 「彼女」「恋人」「同棲」を含めておらず、
// 「同棲中の彼女」等のリポジトリ収録キャラでも初対面扱いのまま漏れていた）。
// 「彼女」単独は入れん。三人称代名詞としての「彼女」（「彼女は一瞬戸惑い」「彼女の部屋で」）まで
// 拾ってしまい、シナリオ本文が地の文で「彼女」を使っただけの初対面キャラを既存関係と誤判定する
// （char-koharu-ex/桜庭さくら、import-charap-ダウナーお姉さんに拾われる話で実際に発生）。
// 恋人を指す用法だけを拾える形へ分解する。
export const ESTABLISHED_RELATIONSHIP_KEYWORDS: readonly string[] = [
  "夫婦",
  // 「結婚して10年になる妻」のように夫婦の語を使わん既存関係の書き方（敵対レビュー・18巡目）
  "結婚",
  "妻",
  "夫",
  "婚約",
  "幼馴染",
  "同僚",
  "家族",
  "彼女がい",
  "彼女にな",
  "元彼女",
  "彼女持ち",
  "彼氏",
  "恋人",
  "同棲",
] as const;

const isStrangerEncounter = (scenario: string, relationship: string): boolean => {
  // 既存関係の語は両方のフィールドを見る。UI作成キャラは「あなたとの関係」の入力が
  // 【シナリオ】へ入り【関係性】が空になるため（ou-edit-screen.tsx）、relationship だけを
  // 見とると「SNSで知り合って10年になる夫婦」が scenario の「SNSで」に反応して
  // 初対面扱いになっていた（敵対レビュー #1236・18巡目）。
  if (
    ESTABLISHED_RELATIONSHIP_KEYWORDS.some(
      (keyword) => relationship.includes(keyword) || scenario.includes(keyword),
    )
  ) {
    return false;
  }
  const combined = `${scenario}\n${relationship}`;
  return ENCOUNTER_STRANGER_KEYWORDS.some((keyword) => combined.includes(keyword));
};

// 特定のプリセット名（ナンパ等）を焼き込まず、どのキーワードで一致しても使える表現にする。
// 反応そのもの（どう感じるか・どちらが先か）を決めつけるとキャラ設定に無い態度の指定になるため、
// 描写に使える具体的な手がかりだけを渡し、反応の中身はキャラ設定に委ねる（0055番マイグレーションと同じ方針）。
//
// #1460: 「積み上がっとらんものを先取りせん」の抽象的な注意だけでは、モデルがどこまで
// 守るかは運任せやった。実測(.work/e2e-results/vlong-dogfood/2026-08-17-phase14,15)では
// phase13で一度収まった「これからも、お話しできますか？」がターン1でまた出た。
// 実際に交わした往復数（exchangeCount）はコードが数えられる具体的な事実であって評価や
// 態度の指定やない。抽象的な「この時点で」を実数へ差し替えることで、同じ注意を
// 具体的なデータとして渡す（キャラシート設計スキルの「位置・具体性が量に勝る」と同じ理由）。
const buildStrangerTensionText = (exchangeCount: number | undefined): string => {
  const continuityLine =
    exchangeCount === undefined
      ? "・積み上がっとらんものを先取りせん: この時点で二人の間にあるのは【シナリオ】に書かれた分だけ。まだ交わしとらん約束、まだ確かめ合うとらん気持ち、まだ重ねとらん時間を、既にあるものとして書かん。どう感じるか自体はキャラ設定に従う。"
      : `・積み上がっとらんものを先取りせん: 実際に言葉を交わしたのはまだ${exchangeCount}往復だけ。まだ交わしとらん約束、まだ確かめ合うとらん気持ち、まだ重ねとらん時間を、既にあるものとして書かん。どう感じるか自体はキャラ設定に従う。`;
  return (
    "声をかけられて、あるいは知り合ってから間もない場面であることを踏まえ、次を具体的な描写に落とし込む。反応の中身や向き合い方はキャラ設定に従う。\n" +
    "・出会った直後特有の空気感: 周囲の物音、相手との距離、今いる場所の気配を毎ターンの描写に具体的に織り込む。\n" +
    "・この状況ならではの身体感覚: 鼓動、体温、声の調子、視線、間合いの詰まり方など、生理的な手がかりを描写に使う。\n" +
    continuityLine
  );
};

// 内面の中身を決めつけるとキャラ設定に無い態度の指定になるため、
// 継続性（その場限りの反応で終わらせない）だけを要求し、中身はキャラ設定に委ねる（0055番マイグレーションと同じ方針）。
const CONTINUITY_POINTS = [
  "状況: 場所・体勢・服の状態・相手との距離を、前のターンから連続する形で毎回具体的に更新する。",
  "雰囲気: 時間帯・光の加減・周囲の音・匂い・空気の温度を描写に含める。",
] as const;

// 「呼吸の乱れ」「距離の詰め合い」は、身体がもう関わっとる場面の手がかり。会話の
// ターンへ毎回出すと、まだ何も起きとらんうちから息を乱させることになり、
// STRANGER_TENSION_TEXT の「積み上がっとらんものを先取りせん」と正面から衝突する
// （敵対レビュー 2026-08-17）。ブロック自体を会話ターンへ広げた時に、この 1 点だけ
// 一緒に付いて行っとった。
const PHYSICAL_EXCHANGE_POINT =
  "生物的な駆け引き: 体温、匂い、呼吸の乱れ、視線の絡み、距離の詰め合いを身体感覚として描写する。";

const INTERIOR_POINT =
  "内面の描写: 前のターンから続く一続きの物語として、その場限りの反応で終わらせない。内面の中身はキャラ設定に従う。";

const buildCommonTensionText = (includePhysicalExchange: boolean): string => {
  const points = [
    ...CONTINUITY_POINTS,
    ...(includePhysicalExchange ? [PHYSICAL_EXCHANGE_POINT] : []),
    INTERIOR_POINT,
  ];
  return [
    `次の${points.length}点を毎ターン反映する。`,
    ...points.map((point, index) => `${index + 1}. ${point}`),
  ].join("\n");
};

export const buildEncounterTensionDirective = (
  scenario: string,
  relationship: string,
  options: { includePhysicalExchange?: boolean; exchangeCount?: number } = {},
): string => {
  const sections = [
    isStrangerEncounter(scenario, relationship)
      ? buildStrangerTensionText(options.exchangeCount)
      : null,
    buildCommonTensionText(options.includePhysicalExchange ?? false),
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n");

  return `\n【出会いの空気】\n${sections}`;
};
