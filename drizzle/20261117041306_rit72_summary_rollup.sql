ALTER TABLE `v2_summary` ADD `from_turn` integer;--> statement-breakpoint
ALTER TABLE `v2_summary` ADD `to_turn` integer;--> statement-breakpoint
ALTER TABLE `v2_summary` ADD `source_hash` text;--> statement-breakpoint
ALTER TABLE `v2_summary` ADD `invalidated_at` integer;--> statement-breakpoint
CREATE INDEX `v2_summary_active_idx` ON `v2_summary` (`conversation_id`,`invalidated_at`,`level`,`to_turn`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_summary_range_uq` ON `v2_summary` (`conversation_id`,`level`,`from_turn`,`to_turn`,`source_hash`);