-- conversation_share の FK に ON DELETE CASCADE を後付けする。
-- SQLite では既存カラムの FK 制約を直接変更できないため、
-- 新テーブル作成 → 既存データを INSERT → 旧テーブル DROP → RENAME の手順を踏む。
-- IF NOT EXISTS を多用して 再実行時も DROP IF EXISTS で旧テーブル不在による失敗を避ける。

CREATE TABLE IF NOT EXISTS conversation_share_new (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 既存 conversation_share の中身を新テーブルへ移送する。
-- 親レコードが既に消えている孤児行はここで FK 違反を防ぐため SELECT 段階で除外する。
INSERT OR IGNORE INTO conversation_share_new (id, conversation_id, user_id, payload, created_at)
SELECT cs.id, cs.conversation_id, cs.user_id, cs.payload, cs.created_at
FROM conversation_share cs
WHERE EXISTS (SELECT 1 FROM conversation c WHERE c.id = cs.conversation_id)
  AND EXISTS (SELECT 1 FROM user u WHERE u.id = cs.user_id);

DROP TABLE IF EXISTS conversation_share;
ALTER TABLE conversation_share_new RENAME TO conversation_share;

CREATE INDEX IF NOT EXISTS idx_share_conversation ON conversation_share(conversation_id);
CREATE INDEX IF NOT EXISTS idx_share_user ON conversation_share(user_id);
