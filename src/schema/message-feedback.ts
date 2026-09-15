import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { characterTable } from "./character";
import { conversationTable } from "./conversation";
import { messageTable } from "./message";
import { userTable } from "./user";

export const messageFeedbackTable = sqliteTable(
  "message_feedback",
  {
    messageId: text("message_id")
      .primaryKey()
      .references(() => messageTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversationTable.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    rating: text("rating", { enum: ["good", "bad"] }).notNull(),
    // 「イマイチ」シートで選んだ／書いた減点理由。任意（サムズ操作だけなら null）。
    reason: text("reason"),
    messageContent: text("message_content").notNull(),
    previousUserContent: text("previous_user_content"),
    variantId: text("variant_id"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("message_feedback_user_rating_idx").on(table.userId, table.rating, table.updatedAt),
    index("message_feedback_character_idx").on(table.characterId, table.updatedAt),
  ],
);
