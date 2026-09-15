CREATE TABLE IF NOT EXISTS `rag_embedding_cache` (
  `query_hash` text PRIMARY KEY NOT NULL,
  `embedding` text NOT NULL,
  `created_at` integer NOT NULL
);
