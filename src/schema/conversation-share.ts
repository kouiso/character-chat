import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { conversationTable } from "./conversation";
import { userTable } from "./user";

export const conversationShareTable = sqliteTable(
  "conversation_share",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversationTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    payload: text("payload").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }),
  },
  (table) => [
    index("idx_share_conversation").on(table.conversationId),
    index("idx_share_user").on(table.userId),
  ],
);
