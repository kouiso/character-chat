CREATE TABLE `v2_turn_commit` (
	`conversation_id` text NOT NULL,
	`turn` integer NOT NULL,
	`write_id` text,
	`digest` text,
	`write_nonce` text NOT NULL,
	`owner_guard` integer NOT NULL,
	`commit_guard` integer NOT NULL,
	PRIMARY KEY(`conversation_id`, `turn`),
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_turn_commit_owner" CHECK("v2_turn_commit"."owner_guard" = 1),
	CONSTRAINT "v2_turn_commit_cas" CHECK("v2_turn_commit"."commit_guard" = 1)
);
