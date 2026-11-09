CREATE TABLE `v2_login_bonus` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`streak` integer NOT NULL,
	`amount` integer NOT NULL,
	`ledger_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `v2_feature_pass` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ledger_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_login_bonus_user_day_unique` ON `v2_login_bonus` (`user_id`,`day`);
--> statement-breakpoint
CREATE INDEX `v2_feature_pass_user_idx` ON `v2_feature_pass` (`user_id`,`expires_at`);
