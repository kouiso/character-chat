CREATE TABLE `v2_chunk_rejection` (
	`message_id` text NOT NULL,
	`seq` integer NOT NULL,
	`attempt` integer NOT NULL,
	`reasons_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `seq`),
	FOREIGN KEY (`message_id`) REFERENCES `v2_message`(`id`) ON UPDATE no action ON DELETE no action
);
