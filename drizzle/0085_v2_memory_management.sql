CREATE TABLE `v2_memory_context` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`worldline_id` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `v2_conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worldline_id`) REFERENCES `v2_memory_worldline`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `v2_memory_dependency` (
	`worldline_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`parent_id` text NOT NULL,
	PRIMARY KEY(`worldline_id`, `memory_id`, `parent_id`),
	FOREIGN KEY (`worldline_id`) REFERENCES `v2_memory_worldline`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`memory_id`) REFERENCES `v2_memory`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `v2_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `v2_memory_operation` (
	`id` text PRIMARY KEY NOT NULL,
	`worldline_id` text NOT NULL,
	`request_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`memory_id` text NOT NULL,
	FOREIGN KEY (`worldline_id`) REFERENCES `v2_memory_worldline`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_memory_operation_request_idx` ON `v2_memory_operation` (`worldline_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `v2_memory_record` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`worldline_id` text NOT NULL,
	`memory_key` text NOT NULL,
	`kind` text NOT NULL,
	`current` integer DEFAULT true NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`source_type` text NOT NULL,
	`source_message_id` text,
	`source_revision` integer,
	`source_sequence` integer,
	`character_version_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `v2_memory`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worldline_id`) REFERENCES `v2_memory_worldline`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_memory_record_current_idx` ON `v2_memory_record` (`worldline_id`,`kind`,`memory_key`) WHERE "v2_memory_record"."current" = 1;--> statement-breakpoint
CREATE TABLE `v2_memory_source` (
	`worldline_id` text NOT NULL,
	`message_id` text NOT NULL,
	`revision` integer NOT NULL,
	`sequence` integer NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`source_turn` integer NOT NULL,
	`character_version_id` text NOT NULL,
	PRIMARY KEY(`worldline_id`, `message_id`, `revision`),
	FOREIGN KEY (`worldline_id`) REFERENCES `v2_memory_worldline`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_memory_source_sequence_idx` ON `v2_memory_source` (`worldline_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `v2_memory_tombstone` (
	`worldline_id` text NOT NULL,
	`memory_key` text NOT NULL,
	`kind` text NOT NULL,
	`source_message_id` text DEFAULT '' NOT NULL,
	`source_revision` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`worldline_id`, `kind`, `memory_key`, `source_message_id`, `source_revision`),
	FOREIGN KEY (`worldline_id`) REFERENCES `v2_memory_worldline`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `v2_memory_worldline` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`extraction_epoch` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
