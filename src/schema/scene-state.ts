import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod/v4";

import { characterTable } from "./character";
import { conversationTable } from "./conversation";

export const sceneLocationTable = sqliteTable("scene_location", {
  id: text("id").primaryKey().notNull(),
  nameJp: text("name_jp").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sceneLocationTagTable = sqliteTable("scene_location_tag", {
  locationId: text("location_id")
    .notNull()
    .references(() => sceneLocationTable.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
});

export const conversationSceneStateTable = sqliteTable("conversation_scene_state", {
  conversationId: text("conversation_id")
    .primaryKey()
    .notNull()
    .references(() => conversationTable.id, { onDelete: "cascade" }),
  locationId: text("location_id").references(() => sceneLocationTable.id),
  currentOutfitId: text("current_outfit_id"),
  // #444: 画像生成へそのまま渡す背景タグ。scene_location 正規化とは別に、
  // 解決済みの SD 背景タグを会話単位で保持して場所の連続性を保つ。
  backgroundTag: text("background_tag"),
  undressLevel: text("undress_level").notNull().default("clothed"),
  matePresent: integer("mate_present").notNull().default(0),
  lastPose: text("last_pose"),
  lastCamera: text("last_camera"),
  mood: text("mood"),
  updatedAt: integer("updated_at").notNull(),
});

// #444: キャラ固有の既定背景。scene_state 未更新の新規会話でも舞台を画像へ反映する。
export const characterSceneDefaultTable = sqliteTable("character_scene_default", {
  characterId: text("character_id")
    .primaryKey()
    .notNull()
    .references(() => characterTable.id, { onDelete: "cascade" }),
  backgroundTag: text("background_tag").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const conversationSceneBodyFluidTable = sqliteTable("conversation_scene_body_fluid", {
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversationTable.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
});

export const UNDRESS_LEVELS = [
  "clothed",
  "partial_top",
  "topless",
  "partial_bottom",
  "bottomless",
  "nude",
] as const;

export const sceneStatePatchSchema = z.object({
  location_id: z.string().optional(),
  undress_level: z.enum(UNDRESS_LEVELS).optional(),
  mate_present: z.number().int().min(0).max(1).optional(),
  body_fluid_add: z.array(z.string()).optional(),
  body_fluid_remove: z.array(z.string()).optional(),
  mood: z.string().nullable().optional(),
  last_pose: z.string().nullable().optional(),
  last_camera: z.string().nullable().optional(),
});

export type SceneStatePatch = z.infer<typeof sceneStatePatchSchema>;
