CREATE TABLE `v2_image_generation` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`status` text NOT NULL,
	`task_id` text,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`negative_prompt` text NOT NULL,
	`seed` integer,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`steps` integer NOT NULL,
	`guidance_scale` real NOT NULL,
	`sampler` text NOT NULL,
	`r2_key` text,
	`failure_json` text,
	`cost_estimate_usd` real,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `v2_message`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v2_image_generation_status_check" CHECK("v2_image_generation"."status" in ('running','succeeded','failed'))
);
--> statement-breakpoint
CREATE INDEX `v2_image_generation_conv_idx` ON `v2_image_generation` (`conversation_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `v2_message` ADD `image_key` text;