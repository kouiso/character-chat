// プレイヤーへの約束（芯）の達成度をターン本文から測る。
// シートの【プレイヤーへの約束】セクションに書かれた「このキャラがどう落ちるか」が
// 実際の出力に出ているかを、項目ごとに機械判定する。パターンは judge に置いて
// bench のファンタジー芯チェック（transcript 走査）とランタイムで共有する。
//
// このチェックは「芯の要素が本文に現れたか」を数えるだけで、良し悪しの合成判定は
// しない（腕の比較は bench 側の集計が担う）。
//
// 対象項目（さくら芯 v2 2026-09-17 局長口述 — 言葉巧みな誘い込み→体は喜ぶ→心も犯される）:
// - resistance: 弱い抵抗。「やめて」「いけません」「だめ」——ただし悲鳴ではない
// - scream: 悲鳴・助けを求める叫び。**出ないのが正解**（ネガティブ項目）
// - swept: 断れず流される。「断れず」「流され」「そのまま」「なされるがまま」
// - pleasure: 体が喜んでしまう。「感じて」「疼く」「濡れて」「悦んで」
// - taboo: 背徳感。「いけない」「こんなこと」「恥ずかしい」
// - corruption: 心も犯されていく。「犯され」「堕ち」「壊れ」「知らない自分」
// - creampie: 中出し。「中に出す」「注がれる」「注ぎ込む」
// - repetition: 二回戦・三回戦・朝まで
// - gangbang: 乱交。「仲間」「他の男」「回され」
//
// 丁寧語残存（崩れかけて崩れきらない）は register-check の dialogueRegisterBroken を
// 使う。芯の達成度と丁寧語は別軸なので、ここでは返さない。

const corePatterns = {
  // 弱い抵抗（小声・言い淀み）。「助けて」は scream 側なのでここに入れない。
  resistance: /(やめて|いけません|だめ|やだ|嫌だ|離して|外して|やめ(て|ろ|なさい))/u,
  // 悲鳴・助けを求める叫び。芯では「悲鳴や助けては上げない」——これが出たら芯から外れる。
  // 「誰か」単体は「誰かに見られたら…」の世間体の心配で、悲鳴やない（実測 core2 両 run の誤検出）。
  scream: /(助けて|誰か(助け|来て|いない)|悲鳴|叫(ん|び)|きゃあ|ひゃあ|逃げて)/u,
  // 断れず・流される。力の無理やりではなく「押しが強くて断れない」方。
  swept:
    /(断れ|流され|ついて(い|行)|そのまま|なされるがまま|押し(が|に)|引かれる|導かれ|抗え(ず|ない))/u,
  // 体が喜んでしまう。恥ずかしいのに反応してしまう感覚。
  pleasure:
    /(喜ん|感じ(て|てしまう|ちゃう)|疼く|濡れ|熱く|悦(ん|び)|快楽|気持ちよく|声が漏れ|勝手に)/u,
  // 背徳感。「いけないことをしている」という内心。
  taboo: /(いけない|こんな(こと|の)|恥ずかしい|淫ら|汚され|汚れて|世間体|イメージとは裏腹)/u,
  // 心も犯されていく。堕ちていく感覚。
  corruption: /(犯され|堕ち|壊れ|知らない自分|変わって(い|ゆ)|溺れ|負けて(い|ゆ))/u,
  // 中出しは「中に出す」「中で出す」「注がれる」「注ぎ込む」「子宮口に注がれる」等。
  // 実測（2026-09-17 core-1 t9）: 「中で…出してる」「子宮口に直接注がれ始める」「どくどくと
  // 注がれる」を拾えんかった（「中に」前提と「子宮口に」未対応）。言い回しの広さを取る。
  // core2-2 t9: 「精液が注がれ」「中で、広がってる」「全部、入ってきて」——「注がれ」単独と
  // 「中で広がる・満たす・入る」も拾う。
  creampie:
    /(中(に|で)(出(す|し|て)|注(ぐ|いで|がれ|がっ)|広が|満た|入っ|溢れ)|注ぎ込(む|まれ|ん)|注がれ(る|始め|る精)?|子宮(口)?(に|へ|が)(注|流)|精(液|を|が)(注|流))/u,
  repetition:
    /(二回戦|三回戦|もう一度|また(今日|今夜)?(あなた|男|彼)|繰り返し|何度も|朝まで|続け(て|られ))/u,
  gangbang: /(仲間|他の男|別の男|ほかの男|渡され|回され|順番|交代|乱交|チーム|皆?さん?で|皆で)/u,
} as const;

export type CoreItem = keyof typeof corePatterns;

export type FantasyCoreResult = {
  items: Record<CoreItem, boolean>;
  // ヒットした項目の本文断片（先頭 60 字まで）。レポートの証拠表示に使う。
  evidence: Partial<Record<CoreItem, string>>;
};

// 本文に各芯項目が現れたかを返す。body は <response> で包まれた生本文（タグ付き）。
export const fantasyCoreCheck = (body: string): FantasyCoreResult => {
  const items = {} as Record<CoreItem, boolean>;
  const evidence: Partial<Record<CoreItem, string>> = {};
  for (const [item, pattern] of Object.entries(corePatterns)) {
    const match = body.match(pattern);
    items[item as CoreItem] = match !== null;
    if (match) evidence[item as CoreItem] = match[0].slice(0, 60);
  }
  return { items, evidence };
};

export const CORE_ITEMS = Object.keys(corePatterns) as CoreItem[];
