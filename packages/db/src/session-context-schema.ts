import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { v2ConversationTable } from "./v2-schema";

export const v2SessionContextTable = sqliteTable(
  "v2_session_context",
  {
    conversationId: text("conversation_id")
      .primaryKey()
      .references(() => v2ConversationTable.id),
    ownerUserId: text("owner_user_id").notNull(),
    characterId: text("character_id").notNull(),
    worldlineId: text("worldline_id").notNull(),
    characterVersionId: text("character_version_id").notNull(),
    characterSnapshot: text("character_snapshot").notNull(),
    sourceStartTurn: integer("source_start_turn").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("v2_session_context_worldline_idx").on(table.worldlineId)],
);
