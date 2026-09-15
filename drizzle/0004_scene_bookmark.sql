CREATE TABLE scene_bookmark (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  character_name TEXT NOT NULL,
  character_id TEXT REFERENCES character(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX scene_bookmark_user_id_created_at_idx ON scene_bookmark(user_id, created_at);
CREATE INDEX scene_bookmark_user_id_character_id_idx ON scene_bookmark(user_id, character_id);
