CREATE TABLE comic (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  title TEXT,
  panels TEXT NOT NULL,
  style TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX comic_user_id_created_at_idx ON comic(user_id, created_at);
CREATE INDEX comic_conversation_id_created_at_idx ON comic(conversation_id, created_at);
