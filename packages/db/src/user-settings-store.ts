// ユーザー設定の読み出し（RIT-199）。engine の要約係も使うので db 層に置く。
// drizzle 二重版の型衝突を避けて生 D1 で読む。
export const readSafeMode = async (db: D1Database, userId: string): Promise<boolean> => {
  const row = await db
    .prepare("SELECT safe_mode FROM v2_user_settings WHERE user_id = ?")
    .bind(userId)
    .first<{ safe_mode: number }>();
  return row?.safe_mode === 1;
};
