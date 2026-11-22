CREATE INDEX `v2_conversation_user_character_updated_idx` ON `v2_conversation` (`user_id`,`character_id`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_v2_character_keep` (
	`character_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kept_at` integer NOT NULL,
	PRIMARY KEY(`character_id`, `user_id`),
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_v2_character_keep`("character_id", "user_id", "kept_at") SELECT "character_id", "user_id", "kept_at" FROM `v2_character_keep` WHERE EXISTS(SELECT 1 FROM `character` WHERE `character`.`id` = `v2_character_keep`.`character_id`);--> statement-breakpoint
DROP TABLE `v2_character_keep`;--> statement-breakpoint
ALTER TABLE `__new_v2_character_keep` RENAME TO `v2_character_keep`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `v2_character_keep_user_idx` ON `v2_character_keep` (`user_id`);
