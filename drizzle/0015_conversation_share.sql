-- 会話の共有スナップショット。生の conversation を露出すると以降の編集も漏れるため、
-- 共有時に payload (character + messages) を凍結して別行に保存する。
CREATE TABLE IF NOT EXISTS conversation_share (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_conversation ON conversation_share(conversation_id);
CREATE INDEX IF NOT EXISTS idx_share_user ON conversation_share(user_id);
