ALTER TABLE streaming_chunk ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_streaming_chunk_user_id ON streaming_chunk(stream_id, user_id);
