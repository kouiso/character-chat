-- 元々あったキャラ (char-*) が import-* に埋もれて discover で見つけにくいため、
-- 明示的な並び順カラムを追加してアプリで優先表示できるようにする。
-- 既存環境への idempotent 適用: ALTER TABLE で既に列が存在する場合は無視される運用想定。

ALTER TABLE character ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

-- char-* は元キャラなので最優先 (0), import-* は後ろに送る (100)。
UPDATE character SET display_order = 0 WHERE id LIKE 'char-%';
--> statement-breakpoint
UPDATE character SET display_order = 100 WHERE id LIKE 'import-%';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS character_display_order_idx ON character(display_order, created_at);
