CREATE TABLE `v2_model_attempt_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`call_index` integer NOT NULL,
	`attempt_index` integer NOT NULL,
	`attempt_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_model_attempt_audit_scope_idx` ON `v2_model_attempt_audit` (`user_id`,`character_id`,`conversation_id`,`run_id`,`call_index`,`attempt_index`);