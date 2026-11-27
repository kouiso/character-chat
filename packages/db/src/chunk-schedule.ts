// RIT-67: splitChunks で分けた塊の「送る予定時刻」。塊と塊の間は前の塊の字数に比例、
// 長すぎる塊で間が伸びすぎんよう上限を掛ける。
// 60ms/字・30s 上限だと 1 返信あたりの露出に 20 秒近く掛かり「遅い」実感になった
// （2026-11-16 本番実測、生成 11s＋配信 19s）。間は残しつつ 1/3 に詰める。
export const CHUNK_MS_PER_CHAR = 20;
export const CHUNK_MAX_GAP_MS = 8_000;

// 間は読む文の長さで決める。タグは画面に出ないので数えない
//（数えると 1 塊につきタグの 15〜21 字＝300〜420ms が毎回の間に乗る）。
export const chunkVisibleLength = (text: string): number =>
  text.replace(/<\/?(action|dialogue|inner)>/g, "").length;

// 1 つ前に配った塊を出してから、次の塊を出すまでに空けるミリ秒。
// その返事の最初の塊（前の塊が無い）は 0。式はここ 1 か所だけに持つ
//（出来事の gapMs と v2_chunk.send_at で式が食い違わんため）。
export const chunkGapMs = (previousText: string | undefined): number =>
  previousText === undefined
    ? 0
    : Math.min(chunkVisibleLength(previousText) * CHUNK_MS_PER_CHAR, CHUNK_MAX_GAP_MS);

// 先頭の塊は base（=保存時刻）で即出し、2個目以降は前の塊の読み時間ぶん遅らせる。
// 空の塊は 0ms（同時刻）扱いで壊れん。
export const chunkSendTimes = (texts: string[], base: number): number[] => {
  const times: number[] = [];
  let at = base;
  for (const text of texts) {
    times.push(at);
    at += chunkGapMs(text);
  }
  return times;
};

// 配信用の予定。最初の塊からの経過ミリ秒にして渡す。端末の時計はサーバとずれる（実測で数分）ので、
// 絶対時刻のまま渡すと間が潰れたり伸びたりする。受け取った側が自分の受信時刻で引き直す。
// v2_chunk.send_at は保存時刻基準の絶対値のまま残し、配信の時だけここで差し引く。
export const chunkSendOffsets = (sendAt: number[]): number[] =>
  sendAt.map((at) => at - sendAt[0]);
