CREATE TABLE `v2_currency_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `v2_currency_ledger_kind_check` CHECK(`kind` in ('grant','purchase','spend','refund','bonus'))
);
--> statement-breakpoint
CREATE TABLE `v2_currency_balance` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `v2_currency_balance_nonnegative` CHECK(`balance` >= 0)
);
--> statement-breakpoint
CREATE INDEX `v2_currency_ledger_user_idx` ON `v2_currency_ledger` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_currency_ledger_idempotency_unique` ON `v2_currency_ledger` (`idempotency_key`);
