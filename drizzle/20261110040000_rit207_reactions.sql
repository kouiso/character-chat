CREATE TABLE `v2_catalog_like` (
	`character_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`character_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `v2_catalog_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_v2_catalog_comment_character` ON `v2_catalog_comment` (`character_id`);
--> statement-breakpoint
CREATE TABLE `v2_follow` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `target_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_follow_target` ON `v2_follow` (`kind`, `target_id`);
