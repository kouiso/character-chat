CREATE TABLE `v2_character_document_chunk` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`seq` integer NOT NULL,
	`content` text NOT NULL,
	`vector_id` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `v2_character_document`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `v2_character_document_chunk_doc_idx` ON `v2_character_document_chunk` (`document_id`,`seq`);--> statement-breakpoint
CREATE TABLE `v2_character_document` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`title` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `v2_character_document_char_idx` ON `v2_character_document` (`character_id`,`status`);