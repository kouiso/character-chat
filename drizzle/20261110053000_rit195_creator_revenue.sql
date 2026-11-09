CREATE TABLE `v2_creator_revenue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_ledger_id` text NOT NULL,
	`source_type` text NOT NULL,
	`ref_id` text,
	`gross_amount` integer NOT NULL,
	`share_amount` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_creator_revenue_source_unique` ON `v2_creator_revenue` (`source_ledger_id`);
--> statement-breakpoint
CREATE INDEX `idx_v2_creator_revenue_user` ON `v2_creator_revenue` (`user_id`);
