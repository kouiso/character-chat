import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { characterTable } from "./character";

export const wardrobeOutfitTable = sqliteTable(
  "wardrobe_outfit",
  {
    id: text("id").primaryKey().notNull(),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("wardrobe_outfit_character_idx").on(t.characterId)],
);

export const wardrobeOutfitTagTable = sqliteTable(
  "wardrobe_outfit_tag",
  {
    outfitId: text("outfit_id")
      .notNull()
      .references(() => wardrobeOutfitTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [index("wardrobe_outfit_tag_outfit_idx").on(t.outfitId)],
);

export const wardrobeOutfitOccasionTable = sqliteTable(
  "wardrobe_outfit_occasion",
  {
    outfitId: text("outfit_id")
      .notNull()
      .references(() => wardrobeOutfitTable.id, { onDelete: "cascade" }),
    occasion: text("occasion").notNull(),
  },
  (t) => [index("wardrobe_outfit_occasion_outfit_idx").on(t.outfitId)],
);
