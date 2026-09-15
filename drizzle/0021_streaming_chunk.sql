CREATE TABLE IF NOT EXISTS streaming_chunk (
  stream_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  raw_data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  is_done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (stream_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_streaming_chunk_stream_id ON streaming_chunk(stream_id);
-- TTL cleanup: delete chunks older than 10 minutes in the resume handler
