import { createLogger } from "@/lib/logger";

// 会話ごとの「どこまで記憶抽出したか」。端末ローカルにだけ残す。
// これが無いと /api/memory/extract は毎ターン直近50件を読み直し、同じ往復を
// 何度も抽出モデルへ食わせる（会話が伸びるほど無駄が増える）。
// 消えても再抽出されるだけ（サーバ側が既存ノートを見て重複を弾く）なので localStorage で足りる。
const logger = createLogger("memory-extract-watermark");

const KEY_PREFIX = "ou_memory_extract_since:";

const keyOf = (conversationId: string): string => `${KEY_PREFIX}${conversationId}`;

export const readMemoryExtractSince = (conversationId: string): number | undefined => {
  try {
    const raw = localStorage.getItem(keyOf(conversationId));
    if (!raw) return undefined;
    const parsed = Number(raw);
    // 壊れた値を since として送ると抽出窓がずれる（未来の値なら以後ずっと 0 件になる）。
    // 読めん時は未設定に倒し、直近50件へフォールバックさせる。
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      logger.warn("抽出済み時刻が数値として読めませんでした", { conversationId, raw });
      return undefined;
    }
    return parsed;
  } catch (error) {
    logger.warn("抽出済み時刻を読めませんでした", { conversationId, error });
    return undefined;
  }
};

export const writeMemoryExtractSince = (conversationId: string, since: number): void => {
  if (!Number.isSafeInteger(since) || since < 0) {
    logger.warn("抽出済み時刻として使えん値を渡された", { conversationId, since });
    return;
  }
  try {
    localStorage.setItem(keyOf(conversationId), String(since));
  } catch (error) {
    logger.warn("抽出済み時刻を保存できませんでした", { conversationId, error });
  }
};
