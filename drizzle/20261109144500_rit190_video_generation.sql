CREATE TABLE `v2_video_generation` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`character_id` text NOT NULL,
	`message_id` text,
	`source_message_id` text,
	`task_id` text,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`duration_seconds` integer NOT NULL,
	`resolution` text NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`video_key` text,
	`cost_usd` real,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `v2_video_generation_status_check` CHECK(`status` in ('queued','processing','ok','failed'))
);
--> statement-breakpoint
CREATE INDEX `v2_video_generation_conv_idx` ON `v2_video_generation` (`conversation_id`,`created_at`);