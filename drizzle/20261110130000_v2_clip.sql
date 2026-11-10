CREATE TABLE `v2_clip` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`source_generation_id` text,
	`task_id` text,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`video_key` text,
	`play_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `v2_clip_character_idx` ON `v2_clip` (`character_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `v2_clip_user_idx` ON `v2_clip` (`user_id`,`created_at`);--> statement-breakpoint
