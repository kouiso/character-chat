import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { characterTable } from "./character";
import { userTable } from "./user";

export const conversationTable = sqliteTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    title: text("title").notNull(),
    parentConversationId: text("parent_conversation_id"),
    branchedFromMessageId: text("branched_from_message_id"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    rollingSummary: text("rolling_summary"),
    summaryUpdatedAt: integer("summary_updated_at", { mode: "number" }),
    sexualState: text("sexual_state"),
    sceneState: text("scene_state"),
  },
  (table) => [
    index("conversation_user_id_updated_at_idx").on(table.userId, table.updatedAt),
    index("conversation_parent_conversation_id_idx").on(table.parentConversationId),
  ],
);
