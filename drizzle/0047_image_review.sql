-- キャラ仕上げ工程v2の審査レコード（prompt/instructions/char-approval-process.md）。
-- schema 正本: src/schema/image-review.ts（drizzle snapshot が 0008 で停止しており
-- autogen は誤 diff（既存テーブルの DROP 等）を吐くため、0033 以降の運用に合わせ手書き）。
CREATE TABLE IF NOT EXISTS `image_review` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `r2_key` text NOT NULL,
  `character_id` text NOT NULL,
  `label` text NOT NULL,
  `round` integer NOT NULL DEFAULT 1,
  `intent_comment` text NOT NULL,
  `ai_panel_json` text,
  `director_score` integer,
  `director_comment` text,
  `verdict` text NOT NULL DEFAULT 'pending',
  `image_model` text,
  `seed` integer,
  `prompt` text,
  `created_at` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `image_review_char_idx` ON `image_review` (`character_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `image_review_r2_key_idx` ON `image_review` (`r2_key`);
CREATE INDEX IF NOT EXISTS `image_review_verdict_idx` ON `image_review` (`verdict`);
