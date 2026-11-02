CREATE TABLE `v2_memory_job` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`source_turn` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`publish_attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `v2_message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `v2_memory_job_pending` ON `v2_memory_job` (`conversation_id`,`state`);--> statement-breakpoint
CREATE TABLE `v2_memory_source` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`source_message_id` text NOT NULL,
	`source_content_hash` text NOT NULL,
	`importance` integer NOT NULL,
	`valid_from` text,
	`valid_until` text,
	FOREIGN KEY (`memory_id`) REFERENCES `v2_memory`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `v2_message`(`id`) ON UPDATE no action ON DELETE cascade
);
