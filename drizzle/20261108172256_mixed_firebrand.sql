CREATE TABLE `v2_memory_tombstone` (
	`conversation_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `content_hash`),
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE no action
);
