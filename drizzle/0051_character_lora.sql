-- キャラ別 LoRA 推論(Runware)設定。lora_model 非 NULL かつ phase erotic/climax のとき LoRA 経路が発火する。
-- trigger prompt は visual anchor ブロックを丸ごと置換する(重み付きタグと二重にすると盛り過ぎで崩れる)。
-- 手書き理由: この repo は 0009 以降 raw SQL migrations 運用(drizzle-kit snapshot は 0008 で凍結・generate は対話プロンプトで停止する)。
ALTER TABLE `character` ADD COLUMN `lora_model` text;--> statement-breakpoint
ALTER TABLE `character` ADD COLUMN `lora_weight` real;--> statement-breakpoint
ALTER TABLE `character` ADD COLUMN `lora_trigger_prompt` text;
