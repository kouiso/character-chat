// </action> </dialogue> </inner> の直後、または空行で切る。タグ途中では切らん。
// タグの中身に空行（台詞中の間など）が入ることがあるため、まずタグブロック単位で
// 丸ごと1チャンクとして抜き出し、タグの外に残った地の文だけを空行で分ける。
const TAG_BLOCK = /<(action|dialogue|inner)>[\S\s]*?<\/\1>/g;

// 出力契約（@v2/prompt v0001）は全体を <response>…</response> で包む。包みはチャンクの
// 中身やないので剥がしてから切る。剥がさんと "<response>" だけの断片が独立チャンクになり、
// formatCheck が「閉じられてへんタグ」で落として無関係な再生成が走る。
const RESPONSE_WRAPPER = /^\s*<response>([\S\s]*?)<\/response>\s*$/;
const DANGLING_RESPONSE_TAG = /<\/?response>/g;

// 包みは外側 1 個のはずやが、モデルは入れ子で 2 個目を書くことがある（2026-09-05 deepseek-v3.2、
// 全ターン）。外側を剥がした後も残った <response> は本文やないので全部落とす。閉じタグが無い
// （stop で止めた／途中で切れた）出力も同じ扱い。
const unwrapResponse = (raw: string): string => {
  const wrapped = RESPONSE_WRAPPER.exec(raw);
  const body = wrapped ? wrapped[1] : raw;
  return body.replace(DANGLING_RESPONSE_TAG, "");
};

const splitPlain = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);

export const chunk = (raw: string): string[] => {
  const body = unwrapResponse(raw);
  const result: string[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(TAG_BLOCK)) {
    result.push(...splitPlain(body.slice(lastIndex, match.index)));
    result.push(match[0].trim());
    lastIndex = match.index + match[0].length;
  }
  result.push(...splitPlain(body.slice(lastIndex)));
  return result;
};

// engine/spec 側は splitChunks の名前で呼ぶので、同じ実装をそのままエイリアスしとく。
export const splitChunks = chunk;
