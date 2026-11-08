CREATE TABLE `v2_group_member` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`character_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `v2_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_group_member_unique` ON `v2_group_member` (`group_id`,`character_id`);--> statement-breakpoint
CREATE INDEX `v2_group_member_group_idx` ON `v2_group_member` (`group_id`,`position`);--> statement-breakpoint
CREATE TABLE `v2_group_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`character_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `v2_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `v2_group_memory_character_idx` ON `v2_group_memory` (`character_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `v2_group_message` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`turn` integer NOT NULL,
	`speaker_character_id` text,
	`content` text NOT NULL,
	`voice_mismatch` integer,
	`generation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `v2_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_group_message_turn_unique` ON `v2_group_message` (`group_id`,`turn`);--> statement-breakpoint
CREATE INDEX `v2_group_message_speaker_idx` ON `v2_group_message` (`group_id`,`speaker_character_id`);--> statement-breakpoint
CREATE TABLE `v2_group` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
