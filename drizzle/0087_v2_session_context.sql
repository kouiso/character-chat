CREATE TABLE `v2_session_context` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`worldline_id` text NOT NULL,
	`character_version_id` text NOT NULL,
	`character_snapshot` text NOT NULL,
	`source_start_turn` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_session_context_worldline_idx` ON `v2_session_context` (`worldline_id`);