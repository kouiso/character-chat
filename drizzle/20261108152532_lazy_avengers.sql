CREATE TABLE `v2_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`level` integer NOT NULL,
	`covered_to` integer NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `v2_summary_conversation_idx` ON `v2_summary` (`conversation_id`,`level`,`covered_to`);