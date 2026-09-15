-- v2 リビルド用テーブル。既存テーブルは触らん。character への FK だけ既存へ張る。
-- user は M0 で認証を持たんので FK を張らず user_id は文字列のまま置く。
CREATE TABLE IF NOT EXISTS v2_conversation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES character(id),
  title TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_conversation_user_updated_idx ON v2_conversation(user_id, updated_at);

CREATE TABLE IF NOT EXISTS v2_message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  turn INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  action TEXT,
  dialogue TEXT,
  inner TEXT,
  generation_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_message_conv_turn_role_idx ON v2_message(conversation_id, turn, role);

CREATE TABLE IF NOT EXISTS v2_chunk (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES v2_message(id),
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  judge_json TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_chunk_message_seq_idx ON v2_chunk(message_id, seq);

CREATE TABLE IF NOT EXISTS v2_ledger (
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  turn INTEGER NOT NULL,
  ledger_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, turn)
);

CREATE TABLE IF NOT EXISTS v2_generation (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  turn INTEGER NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  request_json TEXT NOT NULL,
  raw_output TEXT,
  usage_json TEXT,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok','error','aborted')),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_generation_conv_turn_idx ON v2_generation(conversation_id, turn);

CREATE TABLE IF NOT EXISTS v2_memory (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversation(id),
  kind TEXT NOT NULL CHECK (kind IN ('fact','summary','preference')),
  content TEXT NOT NULL,
  source_turn INTEGER,
  embedding BLOB,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS v2_memory_conv_kind_idx ON v2_memory(conversation_id, kind);
