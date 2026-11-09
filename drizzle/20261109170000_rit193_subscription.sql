CREATE TABLE `v2_subscription` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer,
	`ledger_id` text,
	`cancelled_at` integer,
	`updated_at` integer NOT NULL
);
