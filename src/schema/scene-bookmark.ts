import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod/v4";

import { characterTable } from "./character";
import { conversationTable } from "./conversation";
import { messageTable } from "./message";
import { userTable } from "./user";

export const sceneBookmarkTable = sqliteTable(
  "scene_bookmark",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversationTable.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messageTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    snippet: text("snippet").notNull(),
    characterName: text("character_name").notNull(),
    characterId: text("character_id").references(() => characterTable.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("scene_bookmark_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("scene_bookmark_user_id_character_id_idx").on(table.userId, table.characterId),
  ],
);

export const sceneBookmarkInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  snippet: z.string().max(500),
  conversationId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  characterName: z.string().max(80),
  characterId: z.string().min(1).max(128).optional(),
});
