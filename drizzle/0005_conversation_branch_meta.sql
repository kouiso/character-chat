ALTER TABLE conversation ADD parent_conversation_id TEXT REFERENCES conversation(id);
ALTER TABLE conversation ADD branched_from_message_id TEXT REFERENCES message(id);
CREATE INDEX conversation_parent_conversation_id_idx ON conversation(parent_conversation_id);
