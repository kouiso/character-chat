import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { v2ConversationTable, v2MemoryTable } from "./v2-schema";

export const memoryWorldlineTable = sqliteTable("v2_memory_worldline", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  characterId: text("character_id").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  extractionEpoch: integer("extraction_epoch").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const memoryContextTable = sqliteTable("v2_memory_context", {
  conversationId: text("conversation_id")
    .primaryKey()
    .references(() => v2ConversationTable.id),
  worldlineId: text("worldline_id")
    .notNull()
    .references(() => memoryWorldlineTable.id),
});

export const memoryRecordTable = sqliteTable(
  "v2_memory_record",
  {
    memoryId: text("memory_id")
      .primaryKey()
      .references(() => v2MemoryTable.id),
    worldlineId: text("worldline_id")
      .notNull()
      .references(() => memoryWorldlineTable.id),
    memoryKey: text("memory_key").notNull(),
    kind: text("kind", { enum: ["fact", "summary", "preference"] }).notNull(),
    current: integer("current", { mode: "boolean" }).notNull().default(true),
    state: text("state", { enum: ["active", "invalidated", "deleted"] })
      .notNull()
      .default("active"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sourceType: text("source_type", { enum: ["user", "extracted", "summary"] }).notNull(),
    sourceMessageId: text("source_message_id"),
    sourceRevision: integer("source_revision"),
    sourceSequence: integer("source_sequence"),
    characterVersionId: text("character_version_id"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("v2_memory_record_current_idx")
      .on(table.worldlineId, table.kind, table.memoryKey)
      .where(sql`${table.current} = 1`),
  ],
);

export const memorySourceTable = sqliteTable(
  "v2_memory_source",
  {
    worldlineId: text("worldline_id")
      .notNull()
      .references(() => memoryWorldlineTable.id),
    // 元メッセージを物理削除しても再抽出禁止の出典を残すため、即時 FK は張らん。
    messageId: text("message_id").notNull(),
    revision: integer("revision").notNull(),
    sequence: integer("sequence").notNull(),
    state: text("state", { enum: ["active", "invalidated", "deleted"] })
      .notNull()
      .default("active"),
    sourceTurn: integer("source_turn").notNull(),
    characterVersionId: text("character_version_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.worldlineId, table.messageId, table.revision] }),
    uniqueIndex("v2_memory_source_sequence_idx").on(table.worldlineId, table.sequence),
  ],
);

export const memoryDependencyTable = sqliteTable(
  "v2_memory_dependency",
  {
    worldlineId: text("worldline_id")
      .notNull()
      .references(() => memoryWorldlineTable.id),
    memoryId: text("memory_id")
      .notNull()
      .references(() => v2MemoryTable.id),
    parentId: text("parent_id")
      .notNull()
      .references(() => v2MemoryTable.id),
  },
  (table) => [primaryKey({ columns: [table.worldlineId, table.memoryId, table.parentId] })],
);

export const memoryTombstoneTable = sqliteTable(
  "v2_memory_tombstone",
  {
    worldlineId: text("worldline_id")
      .notNull()
      .references(() => memoryWorldlineTable.id),
    memoryKey: text("memory_key").notNull(),
    kind: text("kind", { enum: ["fact", "summary", "preference"] }).notNull(),
    sourceMessageId: text("source_message_id").notNull().default(""),
    sourceRevision: integer("source_revision").notNull().default(0),
    reason: text("reason", { enum: ["deleted", "corrected"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.worldlineId,
        table.kind,
        table.memoryKey,
        table.sourceMessageId,
        table.sourceRevision,
      ],
    }),
  ],
);

export const memoryOperationTable = sqliteTable(
  "v2_memory_operation",
  {
    id: text("id").primaryKey(),
    worldlineId: text("worldline_id")
      .notNull()
      .references(() => memoryWorldlineTable.id),
    requestKey: text("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    // 同一取引の後続 INSERT が作る ID なので、ここでは即時 FK を張らん。
    memoryId: text("memory_id").notNull(),
  },
  (table) => [
    uniqueIndex("v2_memory_operation_request_idx").on(table.worldlineId, table.requestKey),
  ],
);
