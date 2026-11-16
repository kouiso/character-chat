CREATE TABLE `v2_legacy_import` (
	`legacy_table` text NOT NULL,
	`legacy_id` text NOT NULL,
	`v2_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`source_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`imported_at` integer NOT NULL,
	PRIMARY KEY(`legacy_table`, `legacy_id`),
	CONSTRAINT "v2_legacy_import_table_check" CHECK("v2_legacy_import"."legacy_table" in ('conversation','message','memory_note'))
);
--> statement-breakpoint
CREATE INDEX `v2_legacy_import_conversation_idx` ON `v2_legacy_import` (`conversation_id`,`legacy_table`);