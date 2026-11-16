ALTER TABLE `v2_memory` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `v2_memory` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_memory_tombstone` ADD `content` text;--> statement-breakpoint
ALTER TABLE `v2_summary` ADD `redact_pending` integer DEFAULT 0 NOT NULL;