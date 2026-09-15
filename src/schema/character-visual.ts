import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { characterTable } from "./character";

export const characterVisualTable = sqliteTable("character_visual", {
  characterId: text("character_id")
    .primaryKey()
    .notNull()
    .references(() => characterTable.id, { onDelete: "cascade" }),
  hairColor: text("hair_color").notNull(),
  hairStyle: text("hair_style").notNull(),
  hairLength: text("hair_length").notNull(),
  eyeColor: text("eye_color").notNull(),
  skinTone: text("skin_tone").notNull(),
  bodyType: text("body_type").notNull(),
  breastSize: text("breast_size"),
  heightBand: text("height_band"),
  ageApparent: integer("age_apparent").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const characterDistinctiveMarkTable = sqliteTable(
  "character_distinctive_mark",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [index("character_distinctive_mark_char_idx").on(t.characterId)],
);

export const characterDefaultOutfitTagTable = sqliteTable(
  "character_default_outfit_tag",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    weight: real("weight").notNull().default(1.0),
    ord: integer("ord").notNull().default(0),
  },
  (t) => [index("character_default_outfit_tag_char_idx").on(t.characterId)],
);

export const characterUndressProgressionTable = sqliteTable(
  "character_undress_progression",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    level: text("level").notNull(),
    tag: text("tag").notNull(),
  },
  (t) => [index("character_undress_progression_char_idx").on(t.characterId)],
);

// キャラクターの固定サブ画像（R2 に保存済みのエロ立ち絵等）
export const characterSubImageTable = sqliteTable(
  "character_sub_image",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id, { onDelete: "cascade" }),
    // R2 キー（例: sub/char-koharu/sakura-jiigo-sweat.png）
    r2Key: text("r2_key").notNull(),
    ord: integer("ord").notNull().default(0),
    // 生成時パラメータの完全記録（migration 0048）。生成した瞬間に入れる（後付けバックフィル禁止）。
    // 注意: 実DBには raw migration 由来の approval / image_model / image_provider 列も存在する（schema未反映の歴史的ドリフト）。
    genParams: text("gen_params", { mode: "json" }).$type<Record<string, unknown> | null>(),
    // 履歴方式（migration 0049）: NULL=表示中、値あり=差し替え済みの履歴。
    // 行の DELETE と R2 オブジェクトの削除は禁止 — 過去チャット参照と審査履歴を守る。
    archivedAt: integer("archived_at"),
  },
  (t) => [index("character_sub_image_char_idx").on(t.characterId, t.ord)],
);
