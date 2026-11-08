// v2 リビルド用テーブル宣言。既存テーブル（character 等）は src/schema/* 側の宣言を再 export して使う。
// 列名・制約は drizzle/0070_v2_tables.sql と一致させる。
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { characterTable } from "../../../src/schema/character";

export const v2ConversationTable = sqliteTable(
  "v2_conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    legacySourceUserId: text("legacy_source_user_id"),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    title: text("title").notNull().default(""),
    threadId: text("thread_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    // 会話開始時のキャラ版を固定する。旧会話は NULL のまま character 行を使う。
    characterVersionId: text("character_version_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("v2_conversation_user_updated_idx").on(table.userId, table.updatedAt)],
);

// キャラの版。content_json が正で、character 表の同名列は互換ミラー。
// 版は不変（INSERT専用）で、現在版は character.current_version_id の参照切替。
export const characterVersionTable = sqliteTable(
  "character_version",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    ownerUserId: text("owner_user_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    contentJson: text("content_json").notNull(),
    // 同内容の再送で版を増やさんよう canonical contentJson の SHA-256 で一意にする。
    contentHash: text("content_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("character_version_character_hash_unique").on(table.characterId, table.contentHash),
    uniqueIndex("character_version_character_version_unique").on(table.characterId, table.version),
    index("character_version_character_idx").on(table.characterId),
  ],
);

export const characterRevisionTable = sqliteTable(
  "character_revision",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    revision: integer("revision").notNull(),
    versionId: text("version_id")
      .notNull()
      .references(() => characterVersionTable.id),
    action: text("action", {
      enum: ["create", "update", "restore", "legacy"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.revision] }),
    index("character_revision_character_idx").on(table.characterId),
  ],
);

export const v2MessageTable = sqliteTable(
  "v2_message",
  {
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
  },
  (table) => [
    uniqueIndex("v2_message_conv_turn_role_idx").on(table.conversationId, table.turn, table.role),
    check("v2_message_role_check", sql`${table.role} in ('user','assistant')`),
  ],
);

export const v2ChunkTable = sqliteTable(
  "v2_chunk",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => v2MessageTable.id),
    seq: integer("seq").notNull(),
    text: text("text").notNull(),
    judgeJson: text("judge_json").notNull(),
    attempt: integer("attempt").notNull().default(1),
    // 塊を画面へ出す予定時刻。既存行は NULL（出し分け側は created_at へ倒す）。
    sendAt: integer("send_at"),
    // 1 = 判定で落ちて配らんかった塊。理由は judge_json に残す（RIT-70）。
    dropped: integer("dropped").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("v2_chunk_message_seq_idx").on(table.messageId, table.seq)],
);

// 窓から押し出された履歴の巻き取り要約（RIT-72）。level 1 = 押し出し分の要約、
// level 2 = レベル 1 がたまった分のまとめ直し。covered_to は履歴先頭から何件を
// この要約（列）が吸収したか。行は追記のみで、画面には最新の level 2 と
// それ以降の level 1 を時系列で見せる。
export const v2SummaryTable = sqliteTable(
  "v2_summary",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id),
    level: integer("level").notNull(),
    coveredTo: integer("covered_to").notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("v2_summary_conversation_idx").on(table.conversationId, table.level, table.coveredTo),
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

export const v2GenerationTable = sqliteTable(
  "v2_generation",
  {
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
  },
  (table) => [
    index("v2_generation_conv_turn_idx").on(table.conversationId, table.turn),
    check("v2_generation_status_check", sql`${table.status} in ('ok','error','aborted')`),
  ],
);

export const v2MemoryTable = sqliteTable(
  "v2_memory",
  {
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
  },
  (table) => [
    index("v2_memory_conv_kind_idx").on(table.conversationId, table.kind),
    check("v2_memory_kind_check", sql`${table.kind} in ('fact','summary','preference')`),
  ],
);

export const v2MemoryJobTable = sqliteTable(
  "v2_memory_job",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => v2ConversationTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => v2MessageTable.id, { onDelete: "cascade" }),
    sourceTurn: integer("source_turn").notNull(),
    state: text("state", { enum: ["pending", "queued", "completed", "failed"] })
      .notNull()
      .default("pending"),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("v2_memory_job_pending").on(table.conversationId, table.state)],
);

export const v2MemorySourceTable = sqliteTable("v2_memory_source", {
  memoryId: text("memory_id")
    .primaryKey()
    .references(() => v2MemoryTable.id, { onDelete: "cascade" }),
  sourceMessageId: text("source_message_id")
    .notNull()
    .references(() => v2MessageTable.id, { onDelete: "cascade" }),
  sourceContentHash: text("source_content_hash").notNull(),
  importance: integer("importance").notNull(),
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
});

// グループ会話（同じ場）。1場=1行。メンバーは v2_group_member。
export const v2GroupTable = sqliteTable("v2_group", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const v2GroupMemberTable = sqliteTable(
  "v2_group_member",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => v2GroupTable.id, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_group_member_unique").on(table.groupId, table.characterId),
    index("v2_group_member_group_idx").on(table.groupId, table.position),
  ],
);

// 場の発言。speaker_character_id が NULL ならユーザー。turn は場内の連番。
export const v2GroupMessageTable = sqliteTable(
  "v2_group_message",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => v2GroupTable.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    speakerCharacterId: text("speaker_character_id"),
    content: text("content").notNull(),
    // 声混ざり検査の記録（RIT-112）。NULL は未検査。
    voiceMismatch: integer("voice_mismatch"),
    generationId: text("generation_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_group_message_turn_unique").on(table.groupId, table.turn),
    index("v2_group_message_speaker_idx").on(table.groupId, table.speakerCharacterId),
  ],
);

// 場での出来事は場にいたキャラだけの記憶へ（RIT-111: その場にいなかったキャラは知らん）。
export const v2GroupMemoryTable = sqliteTable(
  "v2_group_memory",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => v2GroupTable.id, { onDelete: "cascade" }),
    characterId: text("character_id").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("v2_group_memory_character_idx").on(table.characterId, table.groupId)],
);

// Web Push の購読。端末ごとに1行。話しかけの着信に使う。
export const v2PushSubscriptionTable = sqliteTable(
  "v2_push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_push_subscription_endpoint_idx").on(table.endpoint),
    index("v2_push_subscription_user_idx").on(table.userId),
  ],
);
