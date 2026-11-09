CREATE TABLE `v2_image_generation` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`character_id` text NOT NULL,
	`message_id` text,
	`task_id` text,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`negative_prompt` text,
	`seed` integer,
	`status` text NOT NULL,
	`failure_reason` text,
	`image_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_image_generation_status_check" CHECK("v2_image_generation"."status" in ('ok','failed'))
);
--> statement-breakpoint
CREATE INDEX `v2_image_generation_conv_idx` ON `v2_image_generation` (`conversation_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `v2_message` ADD `image_key` text;