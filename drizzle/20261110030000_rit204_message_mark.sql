CREATE TABLE `v2_message_mark` (
	`message_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `kind`)
);
--> statement-breakpoint
CREATE INDEX `idx_v2_message_mark_conversation` ON `v2_message_mark` (`conversation_id`);
