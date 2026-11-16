// キャラの可視範囲は「local・公式・移行元名義」— 一覧/詳細の ownerIds と同じ定義。
// LOCAL_USER_ID 直比較だと移行済み・公式キャラが全部 404 になる（api-tts で実害済み）。
import { LOCAL_USER_ID } from "./identity";

export const canAccessCharacter = async (db: D1Database, characterId: string): Promise<boolean> => {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM character WHERE id = ? AND (
        user_id = ?
        OR is_official = 1
        OR user_id IN (
          SELECT legacy_source_user_id FROM v2_conversation
          WHERE legacy_source_user_id IS NOT NULL
        )
      )`,
    )
    .bind(characterId, LOCAL_USER_ID)
    .first();
  return row !== null;
};
