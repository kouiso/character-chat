import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { characterTable } from "./character";
import { conversationTable } from "./conversation";
import { userTable } from "./user";

export const messageTable = sqliteTable(
  "message",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversationTable.id),
    characterId: text("character_id")
      .notNull()
      .references(() => characterTable.id),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    imageUrl: text("image_url"),
    // R2に保存された画像のオブジェクトキー（imageUrlはNovitaのTTL付きURL用、段階的にこちらへ移行）
    imageKey: text("image_key"),
    imagePrompt: text("image_prompt"),
    imageSeed: text("image_seed"),
    // 画像生成に使用した LoRA 情報。再現性・審査のため image 単位で記録する。
    imageLoraModel: text("image_lora_model"),
    imageLoraWeight: real("image_lora_weight"),
    imageLoraTriggerPrompt: text("image_lora_trigger_prompt"),
    retryCount: integer("retry_count"),
    refusalDetected: integer("refusal_detected"),
    generationModel: text("generation_model"),
    rawOutput: text("raw_output"),
    generationPhase: text("generation_phase"),
    qualityMeta: text("quality_meta").$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("message_conversation_id_created_at_idx").on(table.conversationId, table.createdAt),
    index("message_user_id_idx").on(table.userId),
  ],
);
