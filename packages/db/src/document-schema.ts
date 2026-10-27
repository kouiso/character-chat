import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const documentTable = sqliteTable(
  "v2_document",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    worldlineId: text("worldline_id").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    objectKey: text("object_key").notNull().unique(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    budgetChars: integer("budget_chars").notNull(),
    createdAt: integer("created_at").notNull(),
    slot: integer("slot"),
    status: text("status", { enum: ["indexing", "ready", "deleted"] }).notNull(),
  },
  (table) => [
    uniqueIndex("v2_document_scope_slot").on(table.userId, table.characterId, table.slot),
    check(
      "v2_document_slot_range",
      sql`${table.slot} IS NULL OR (${table.slot} >= 0 AND ${table.slot} < 15)`,
    ),
    check(
      "v2_document_budget_range",
      sql`${table.budgetChars} >= 0 AND ${table.budgetChars} <= 100000`,
    ),
  ],
);

export const documentChunkTable = sqliteTable(
  "v2_document_chunk",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documentTable.id),
    ord: integer("ord").notNull(),
    text: text("text").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.ord] })],
);

export const documentSettingTable = sqliteTable(
  "v2_document_setting",
  {
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    worldlineId: text("worldline_id").notNull(),
    budgetChars: integer("budget_chars").notNull().default(4000),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.characterId, table.worldlineId] }),
    check(
      "v2_document_setting_budget_range",
      sql`${table.budgetChars} >= 0 AND ${table.budgetChars} <= 100000`,
    ),
  ],
);
