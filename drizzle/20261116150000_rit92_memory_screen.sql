ALTER TABLE `v2_memory` ADD `category` text DEFAULT 'long' NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_memory` ADD `origin` text DEFAULT 'extracted' NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_memory` ADD `edited_at` integer;--> statement-breakpoint
CREATE INDEX `v2_memory_conv_active_idx` ON `v2_memory` (`conversation_id`,`deleted_at`,`category`);--> statement-breakpoint
CREATE TABLE `v2_memory_use` (
	`conversation_id` text NOT NULL,
	`turn` integer NOT NULL,
	`memory_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `turn`, `memory_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- 手動行の仕分け: 自動抽出の id は `jobId:index` 形、旧移行の手動行は `legacy-mn-` 始まり。
-- それ以外の既存行（手で足した記憶）は manual へ倒す。
UPDATE `v2_memory` SET `origin` = 'manual' WHERE `id` NOT LIKE '%:%' AND `id` NOT LIKE 'legacy-mn-%';
