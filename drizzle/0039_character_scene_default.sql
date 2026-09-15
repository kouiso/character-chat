-- キャラクターごとの既定背景。conversation_scene_state が未更新（新規会話）でも
-- キャラ固有の舞台（例: bedroom / office / classroom）を画像生成に反映できるようにする。
-- #444: scene_state(updatedAt が新しい) → character_default → keyword → none の解決順で使う。
CREATE TABLE IF NOT EXISTS `character_scene_default` (
  `character_id` text PRIMARY KEY NOT NULL REFERENCES `character`(`id`) ON DELETE CASCADE,
  `background_tag` text NOT NULL,
  `updated_at` integer NOT NULL
);
