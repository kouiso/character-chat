import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { characterTable } from "../../../src/schema/character";

export const characterVersionTable = sqliteTable(
  "character_version",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    snapshot: text("snapshot").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("character_version_content_unique").on(table.characterId, table.snapshot),
    index("character_version_created_idx").on(table.characterId, table.createdAt, table.id),
  ],
);
