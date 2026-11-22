CREATE TABLE `v2_generation_memory` (
	`generation_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`rank` integer NOT NULL,
	`via` text NOT NULL,
	PRIMARY KEY(`generation_id`, `memory_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `v2_generation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`memory_id`) REFERENCES `v2_memory`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "v2_generation_memory_via_check" CHECK("v2_generation_memory"."via" in ('pinned','search'))
);
--> statement-breakpoint
CREATE INDEX `v2_generation_memory_memory_idx` ON `v2_generation_memory` (`memory_id`);--> statement-breakpoint
ALTER TABLE `v2_generation` ADD `memory_retrieval` text;