ALTER TABLE usage_log ADD COLUMN conversation_id text;
CREATE INDEX usage_log_conv_type_idx ON usage_log (conversation_id, type, created_at) WHERE conversation_id IS NOT NULL;
