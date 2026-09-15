import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ragEmbeddingCache = sqliteTable("rag_embedding_cache", {
  queryHash: text("query_hash").primaryKey(),
  embedding: text("embedding").notNull(),
  createdAt: integer("created_at").notNull(),
});
