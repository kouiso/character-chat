CREATE TABLE character (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT NOT NULL,
  greeting TEXT NOT NULL, tags TEXT NOT NULL, avatar TEXT, gender TEXT,
  slug TEXT, is_official INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE v2_conversation (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, character_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', thread_id TEXT NOT NULL, prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE v2_message (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn INTEGER NOT NULL,
  role TEXT NOT NULL, content TEXT NOT NULL, action TEXT, dialogue TEXT,
  inner TEXT, generation_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE v2_chunk (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL, seq INTEGER NOT NULL,
  text TEXT NOT NULL, judge_json TEXT NOT NULL, attempt INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE v2_ledger (
  conversation_id TEXT NOT NULL, turn INTEGER NOT NULL, ledger_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, turn)
);
CREATE TABLE v2_generation (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn INTEGER NOT NULL,
  model TEXT NOT NULL, prompt_version TEXT NOT NULL, system_prompt TEXT NOT NULL,
  request_json TEXT NOT NULL, raw_output TEXT, usage_json TEXT, latency_ms INTEGER,
  status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL
);
