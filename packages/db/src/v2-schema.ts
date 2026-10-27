// v2 リビルド用テーブル宣言。既存テーブル（character 等）は src/schema/* 側の宣言を再 export して使う。
// 列名・制約は drizzle/0070_v2_tables.sql と加算 migration に一致させる。
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  // 既存行には送信予定が無いため NULL を許し、新規保存では必ず予定時刻を付ける。
  scheduledAt: integer("scheduled_at"),
  createdAt: integer("created_at").notNull(),
});

export const v2ChunkRejectionTable = sqliteTable(
  "v2_chunk_rejection",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => v2MessageTable.id),
    seq: integer("seq").notNull(),
    attempt: integer("attempt").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.seq] })],
);

export const v2TurnDeliveryTable = sqliteTable(
  "v2_turn_delivery",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    startAt: integer("start_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.turn] })],
);

export const v2TurnCommitTable = sqliteTable(
  "v2_turn_commit",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    writeId: text("write_id"),
    digest: text("digest"),
    writeNonce: text("write_nonce").notNull(),
    ownerGuard: integer("owner_guard").notNull(),
    commitGuard: integer("commit_guard").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.turn] }),
    check("v2_turn_commit_owner", sql`${table.ownerGuard} = 1`),
    check("v2_turn_commit_cas", sql`${table.commitGuard} = 1`),
  ],
);

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
  modelAttemptsJson: text("model_attempts_json"),
});

export const v2ModelAttemptAuditTable = sqliteTable(
  "v2_model_attempt_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    runId: text("run_id").notNull(),
    callIndex: integer("call_index").notNull(),
    attemptIndex: integer("attempt_index").notNull(),
    attemptJson: text("attempt_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_model_attempt_audit_scope_idx").on(
      table.userId,
      table.characterId,
      table.conversationId,
      table.runId,
      table.callIndex,
      table.attemptIndex,
    ),
  ],
);

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
