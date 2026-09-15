ALTER TABLE memory_note ADD last_used_at INTEGER;
ALTER TABLE memory_note ADD usage_count INTEGER DEFAULT 0 NOT NULL;
CREATE INDEX memory_note_user_id_last_used_at_idx ON memory_note(user_id, last_used_at);
