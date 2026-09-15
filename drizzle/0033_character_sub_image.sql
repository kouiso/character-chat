CREATE TABLE IF NOT EXISTS `character_sub_image` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `character_id` text NOT NULL REFERENCES `character`(`id`) ON DELETE CASCADE,
  `r2_key` text NOT NULL,
  `ord` integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS `character_sub_image_char_idx` ON `character_sub_image` (`character_id`, `ord`);

-- 既存のサブ画像を登録（R2 に upload 済みのキー）。
-- 環境によって import 済み character が異なるため、存在する character のみ登録する。
INSERT OR IGNORE INTO `character_sub_image` (`character_id`, `r2_key`, `ord`)
SELECT 'char-koharu', 'sub/char-koharu/sakura-jiigo-sweat.png', 0
WHERE EXISTS (SELECT 1 FROM `character` WHERE `id` = 'char-koharu');

INSERT OR IGNORE INTO `character_sub_image` (`character_id`, `r2_key`, `ord`)
SELECT 'char-koharu', 'sub/char-koharu/sakura-bed-sweat.png', 1
WHERE EXISTS (SELECT 1 FROM `character` WHERE `id` = 'char-koharu');

INSERT OR IGNORE INTO `character_sub_image` (`character_id`, `r2_key`, `ord`)
SELECT 'char-koharu', 'sub/char-koharu/sakura-lying-back.png', 2
WHERE EXISTS (SELECT 1 FROM `character` WHERE `id` = 'char-koharu');

INSERT OR IGNORE INTO `character_sub_image` (`character_id`, `r2_key`, `ord`)
SELECT 'import-charap-yakobus', 'sub/import-charap-yakobus/yakobus-extreme-aroused.png', 0
WHERE EXISTS (SELECT 1 FROM `character` WHERE `id` = 'import-charap-yakobus');

INSERT OR IGNORE INTO `character_sub_image` (`character_id`, `r2_key`, `ord`)
SELECT 'import-charap-yakobus', 'sub/import-charap-yakobus/yakobus-face-panting.png', 1
WHERE EXISTS (SELECT 1 FROM `character` WHERE `id` = 'import-charap-yakobus');

INSERT OR IGNORE INTO `character_sub_image` (`character_id`, `r2_key`, `ord`)
SELECT 'import-charap-downer', 'sub/import-charap-downer/downer-halfdress-v2.png', 0
WHERE EXISTS (SELECT 1 FROM `character` WHERE `id` = 'import-charap-downer');

INSERT OR IGNORE INTO `character_sub_image` (`character_id`, `r2_key`, `ord`)
SELECT 'import-charap-downer', 'sub/import-charap-downer/downer-sitting-bed.png', 1
WHERE EXISTS (SELECT 1 FROM `character` WHERE `id` = 'import-charap-downer');
