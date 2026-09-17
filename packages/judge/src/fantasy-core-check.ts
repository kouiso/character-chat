// プレイヤーへの約束（芯）の達成度をターン本文から測る。
// シートの【プレイヤーへの約束】セクションに書かれた「このキャラがどう落ちるか」が
// 実際の出力に出ているかを、項目ごとに機械判定する。パターンは judge に置いて
// bench のファンタジー芯チェック（transcript 走査）とランタイムで共有する。
//
// このチェックは「芯の要素が本文に現れたか」を数えるだけで、良し悪しの合成判定は
// しない（腕の比較は bench 側の集計が担う）。
//
// 対象項目（さくら芯 2026-09-17 局長口述）:
// - 抵抗: 「やめて」「いけません」「逃げ」等
// - 強制: 「無理やり」「強引に」「押さえつけ」等
// - 中出し: 「中に出す」「注ぎ込む」「注がれる」等
// - 絶望: 「絶望」「どうして」「涙」「震え」等
// - 反復: 二回戦・三回戦・「もう一度」等
// - 乱交: 「仲間」「他の男」「渡される」等
// - 背徳感: 「いけない」「こんなこと」「恥ずかしい」等
//
// 丁寧語残存（崩れかけて崩れきらない）は register-check の dialogueRegisterBroken を
// 使う。芯の達成度と丁寧語は別軸なので、ここでは返さない。

const corePatterns = {
  resistance:
    /(やめて|いけません|いや(?!…|、)|逃げ|嫌だ|離して|外して|やめ(て|ろ|なさい))|(抵抗|抗う|拒(む|絶))/u,
  forced: /(無理やり|強引|押さえつけ|押し込め|拘束|逃がさ|逃さ|繋いだ|繋がれ|動け(ない|ず))/u,
  // 中出しは「中に出す」「中で出す」「注がれる」「注ぎ込む」「子宮口に注がれる」等。
  // 実測（2026-09-17 core-1 t9）: 「中で…出してる」「子宮口に直接注がれ始める」「どくどくと
  // 注がれる」を拾えんかった（「中に」前提と「子宮口に」未対応）。言い回しの広さを取る。
  creampie:
    /(中(に|で)(出(す|し|て)|注(ぐ|いで|がれ|がっ))|注ぎ込(む|まれ|ん)|注がれ(る|始め|る精)|子宮(口)?(に|へ|が)(注|流)|精(液|を|が)(注|流))/u,
  despair: /(絶望|どうして|なんで|涙|震え|泣い|嗚咽|苦し)/u,
  repetition:
    /(二回戦|三回戦|もう一度|また(今日|今夜)?(あなた|男|彼)|繰り返し|何度も|朝まで|続け(て|られ))/u,
  gangbang: /(仲間|他の男|別の男|ほかの男|渡され|回され|順番|交代|乱交|チーム|皆?さん?で|皆で)/u,
  taboo: /(いけない|こんな(こと|の)|恥ずかしい|淫ら|汚され|汚れて|堕ち|落ち)/u,
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
