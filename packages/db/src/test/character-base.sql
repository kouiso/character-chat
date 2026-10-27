CREATE TABLE `character` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`name_reading` text,
	`avatar` text,
	`is_official` integer DEFAULT false NOT NULL,
	`system_prompt` text NOT NULL,
	`visual_prompt` text,
	`seed` integer,
	`image_meta` text,
	`lora_model` text,
	`lora_weight` real,
	`lora_trigger_prompt` text,
	`greeting` text NOT NULL,
	`tags` text NOT NULL,
	`sub_avatars` text,
	`gender` text,
	`user_persona_name` text,
	`user_persona_gender` text,
	`user_persona_personality` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`slug` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_slug_unique` ON `character` (`slug`);--> statement-breakpoint
CREATE INDEX `character_user_id_idx` ON `character` (`user_id`);--> statement-breakpoint
CREATE INDEX `character_display_order_idx` ON `character` (`display_order`,`created_at`);--> statement-breakpoint
CREATE INDEX `character_slug_idx` ON `character` (`slug`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`display_name` text
);
