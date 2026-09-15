CREATE TABLE chat_group (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  character_ids TEXT NOT NULL,
  scenario TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX chat_group_user_id_created_at_idx ON chat_group(user_id, created_at);

CREATE TABLE group_message (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  speaker_character_id TEXT,
  content TEXT NOT NULL,
  image_url TEXT,
  image_key TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES chat_group(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX group_message_group_id_created_at_idx ON group_message(group_id, created_at);
CREATE INDEX group_message_user_id_idx ON group_message(user_id);
