CREATE TABLE `v2_character_publish` (
	`character_id` text NOT NULL,
	`user_id` text NOT NULL,
	`summary` text,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`character_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_character_publish_published` ON `v2_character_publish` (`published_at`);
