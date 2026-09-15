import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { userTable } from "./user";

export const groupTable = sqliteTable(
  "chat_group",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    characterIds: text("character_ids", { mode: "json" }).$type<string[]>().notNull(),
    scenario: text("scenario"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("chat_group_user_id_created_at_idx").on(table.userId, table.createdAt)],
);

export const groupMessageTable = sqliteTable(
  "group_message",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groupTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    speakerCharacterId: text("speaker_character_id"),
    content: text("content").notNull(),
    imageUrl: text("image_url"),
    imageKey: text("image_key"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("group_message_group_id_created_at_idx").on(table.groupId, table.createdAt),
    index("group_message_user_id_idx").on(table.userId),
  ],
);
