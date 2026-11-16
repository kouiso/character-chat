// RIT-67: splitChunks で分けた塊の「送る予定時刻」。塊と塊の間は前の塊の字数に比例、
// 長すぎる塊で間が伸びすぎんよう上限を掛ける。
// 60ms/字・30s 上限だと 1 返信あたりの露出に 20 秒近く掛かり「遅い」実感になった
// （2026-11-16 本番実測、生成 11s＋配信 19s）。間は残しつつ 1/3 に詰める。
export const CHUNK_MS_PER_CHAR = 20;
export const CHUNK_MAX_GAP_MS = 8_000;

// 先頭の塊は base（=保存時刻）で即出し、2個目以降は前の塊の読み時間ぶん遅らせる。
// 空の塊は 0ms（同時刻）扱いで壊れん。
export const chunkSendTimes = (texts: string[], base: number): number[] => {
  const times: number[] = [];
  let at = base;
  for (const text of texts) {
    times.push(at);
    at += Math.min(text.length * CHUNK_MS_PER_CHAR, CHUNK_MAX_GAP_MS);
  }
  return times;
};
