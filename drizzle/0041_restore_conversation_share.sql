-- conversation_share テーブルを復元する。
-- 0024_remove_social_tables.sql で DROP されたが、共有機能は存続させるため再作成する。
-- スキーマは 0018_conversation_share_cascade.sql（FK CASCADE 付き最終版）を踏襲。
CREATE TABLE IF NOT EXISTS conversation_share (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_conversation ON conversation_share(conversation_id);
CREATE INDEX IF NOT EXISTS idx_share_user ON conversation_share(user_id);
