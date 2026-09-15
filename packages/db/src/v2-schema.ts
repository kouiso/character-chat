// v2 リビルド用テーブル宣言。既存テーブル（character 等）は src/schema/* 側の宣言を再 export して使う。
// 列名・制約は drizzle/0070_v2_tables.sql と一致させる。
import { blob, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { characterTable } from "../../../src/schema/character";

export const v2ConversationTable = sqliteTable("v2_conversation", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  characterId: text("character_id")
    .notNull()
    .references(() => characterTable.id),
  title: text("title").notNull().default(""),
  threadId: text("thread_id").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const v2MessageTable = sqliteTable("v2_message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => v2ConversationTable.id),
  turn: integer("turn").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  action: text("action"),
  dialogue: text("dialogue"),
  inner: text("inner"),
  generationId: text("generation_id"),
  createdAt: integer("created_at").notNull(),
});

export const v2ChunkTable = sqliteTable("v2_chunk", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => v2MessageTable.id),
  seq: integer("seq").notNull(),
  text: text("text").notNull(),
  judgeJson: text("judge_json").notNull(),
  attempt: integer("attempt").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});

export const v2LedgerTable = sqliteTable(
  "v2_ledger",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    turn: integer("turn").notNull(),
    ledgerJson: text("ledger_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.turn] })],
);

export const v2GenerationTable = sqliteTable("v2_generation", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => v2ConversationTable.id),
  turn: integer("turn").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  requestJson: text("request_json").notNull(),
  rawOutput: text("raw_output"),
  usageJson: text("usage_json"),
  latencyMs: integer("latency_ms"),
  status: text("status", { enum: ["ok", "error", "aborted"] }).notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
});

export const v2MemoryTable = sqliteTable("v2_memory", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => v2ConversationTable.id),
  kind: text("kind", { enum: ["fact", "summary", "preference"] }).notNull(),
  content: text("content").notNull(),
  sourceTurn: integer("source_turn"),
  // bge-m3 1024 次元 float32 の生バイト（script/rag/ingest.ts の rag_chunk と同形式）。M0 は NULL のまま。
  embedding: blob("embedding", { mode: "buffer" }),
  createdAt: integer("created_at").notNull(),
});
