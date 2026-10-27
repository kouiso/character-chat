CREATE TABLE `character_version` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`character_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_version_content_unique` ON `character_version` (`character_id`,`snapshot`);--> statement-breakpoint
CREATE INDEX `character_version_created_idx` ON `character_version` (`character_id`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `character` ADD `profile_revision` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `active_version_id` integer;