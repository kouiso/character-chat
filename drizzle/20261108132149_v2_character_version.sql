CREATE TABLE `character_revision` (
	`character_id` text NOT NULL,
	`revision` integer NOT NULL,
	`version_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`character_id`, `revision`),
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `character_version`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `character_revision_character_idx` ON `character_revision` (`character_id`);--> statement-breakpoint
CREATE TABLE `character_version` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`version` integer NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_version_character_hash_unique` ON `character_version` (`character_id`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `character_version_character_version_unique` ON `character_version` (`character_id`,`version`);--> statement-breakpoint
CREATE INDEX `character_version_character_idx` ON `character_version` (`character_id`);--> statement-breakpoint
ALTER TABLE `character` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `current_version_id` text;--> statement-breakpoint
ALTER TABLE `v2_conversation` ADD `character_version_id` text;