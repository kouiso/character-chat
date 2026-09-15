import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { userTable } from "./user";

export const characterTable = sqliteTable(
  "character",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id),
    name: text("name").notNull(),
    // 表示名のふりがな。シートに読みが書かれとらんキャラが多いので、読みが分かるものだけ
    // 入れて、無い時はルビを出さん（間違った読みを振るより出さん方がまし）。
    nameReading: text("name_reading"),
    avatar: text("avatar"),
    isOfficial: integer("is_official", { mode: "boolean" }).notNull().default(false),
    systemPrompt: text("system_prompt").notNull(),
    visualPrompt: text("visual_prompt"),
    // /api/image 生成時の seed。新規キャラは保存し、既存の null は character ID から安定値を導出する。
    seed: integer("seed", { mode: "number" }),
    // AI vision で avatar PNG から抽出した正規外見記述。
    // /api/image 生成時に anchor として使い、profile↔chat の見た目を一致させる。
    imageMeta: text("image_meta", { mode: "json" }).$type<{
      appearance: string;
      artStyle: string;
      outfit?: string;
      negativePrompt?: string;
    } | null>(),
    // LoRA 推論(Runware)用。loraModel 非 null かつ phase erotic/climax のとき LoRA 経路が発火する。
    // trigger prompt は visual anchor ブロックを置換する(重み付きタグと二重にすると盛り過ぎで崩れる)。
    loraModel: text("lora_model"),
    loraWeight: real("lora_weight"),
    loraTriggerPrompt: text("lora_trigger_prompt"),
    greeting: text("greeting").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    subAvatars: text("sub_avatars", { mode: "json" }).$type<string[]>(),
    gender: text("gender"),
    userPersonaName: text("user_persona_name"),
    userPersonaGender: text("user_persona_gender"),
    userPersonaPersonality: text("user_persona_personality"),
    // 0 = 元キャラ最優先 / 100 = import-* を後方に。並び順は ASC で評価される
    displayOrder: integer("display_order", { mode: "number" }).notNull().default(0),
    slug: text("slug").unique(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("character_user_id_idx").on(table.userId),
    index("character_display_order_idx").on(table.displayOrder, table.createdAt),
    index("character_slug_idx").on(table.slug),
  ],
);
