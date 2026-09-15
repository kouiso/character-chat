import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { characterTable } from "./character";
import { messageTable } from "./message";
import { userTable } from "./user";

export const memoryNoteTable = sqliteTable(
  "memory_note",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    sourceMessageId: text("source_message_id").references(() => messageTable.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    editedAt: integer("edited_at", { mode: "number" }),
    lastUsedAt: integer("last_used_at", { mode: "number" }),
    usageCount: integer("usage_count", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    index("memory_note_user_id_character_id_idx").on(table.userId, table.characterId),
    index("memory_note_user_id_last_used_at_idx").on(table.userId, table.lastUsedAt),
  ],
);
