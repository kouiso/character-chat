CREATE TABLE `v2_document_chunk` (
	`document_id` text NOT NULL,
	`ord` integer NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`document_id`, `ord`),
	FOREIGN KEY (`document_id`) REFERENCES `v2_document`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `v2_document_setting` (
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`worldline_id` text NOT NULL,
	`budget_chars` integer DEFAULT 4000 NOT NULL,
	PRIMARY KEY(`user_id`, `character_id`, `worldline_id`),
	CONSTRAINT "v2_document_setting_budget_range" CHECK("v2_document_setting"."budget_chars" >= 0 AND "v2_document_setting"."budget_chars" <= 100000)
);
--> statement-breakpoint
CREATE TABLE `v2_document` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`worldline_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`object_key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`budget_chars` integer NOT NULL,
	`created_at` integer NOT NULL,
	`slot` integer,
	`status` text NOT NULL,
	CONSTRAINT "v2_document_slot_range" CHECK("v2_document"."slot" IS NULL OR ("v2_document"."slot" >= 0 AND "v2_document"."slot" < 15)),
	CONSTRAINT "v2_document_budget_range" CHECK("v2_document"."budget_chars" >= 0 AND "v2_document"."budget_chars" <= 100000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_document_object_key_unique` ON `v2_document` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `v2_document_scope_slot` ON `v2_document` (`user_id`,`character_id`,`slot`);
