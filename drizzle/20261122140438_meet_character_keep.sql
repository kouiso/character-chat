CREATE TABLE `v2_character_keep` (
	`character_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kept_at` integer NOT NULL,
	PRIMARY KEY(`character_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `v2_character_keep_user_idx` ON `v2_character_keep` (`user_id`);