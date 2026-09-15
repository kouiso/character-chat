-- RAG chunks: glossary terms and exemplar texts for prompt augmentation
-- type: 'glossary' = erotic vocabulary, 'exemplar' = high-quality example turns
-- phase: scene phase (climax/erotic/intimate/conversation/afterglow)
-- character_id: NULL means applies to all characters
-- embedding: 1024-dim float32 array stored as BLOB (little-endian packed floats)
CREATE TABLE IF NOT EXISTS rag_chunk (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('glossary', 'exemplar')),
  phase TEXT NOT NULL,
  character_id TEXT,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS rag_chunk_type_phase ON rag_chunk(type, phase);
CREATE INDEX IF NOT EXISTS rag_chunk_character ON rag_chunk(character_id) WHERE character_id IS NOT NULL;
