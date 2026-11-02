ALTER TABLE `v2_memory` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_memory` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_memory` ADD `pinned` integer DEFAULT false NOT NULL;
