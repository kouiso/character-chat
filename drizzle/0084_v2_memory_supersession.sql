ALTER TABLE `v2_memory` ADD `memory_key` text;--> statement-breakpoint
ALTER TABLE `v2_memory` ADD `superseded_by_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `v2_memory_current_key_idx` ON `v2_memory` (`conversation_id`,`kind`,`memory_key`) WHERE "v2_memory"."memory_key" is not null and "v2_memory"."superseded_by_id" is null;