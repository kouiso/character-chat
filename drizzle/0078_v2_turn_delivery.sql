CREATE TABLE `v2_turn_delivery` (
	`conversation_id` text NOT NULL,
	`turn` integer NOT NULL,
	`start_at` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `turn`),
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
