-- RIT-208: kind に 'tip' を追加。SQLite は CHECK を変更できないためテーブル再構成。
CREATE TABLE `v2_currency_ledger_new` (
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
	CONSTRAINT `v2_currency_ledger_kind_check` CHECK(`kind` in ('grant','purchase','spend','refund','bonus','tip'))
);
--> statement-breakpoint
INSERT INTO `v2_currency_ledger_new` (`id`, `user_id`, `kind`, `amount`, `balance_after`, `reason`, `ref_type`, `ref_id`, `idempotency_key`, `created_at`)
	SELECT `id`, `user_id`, `kind`, `amount`, `balance_after`, `reason`, `ref_type`, `ref_id`, `idempotency_key`, `created_at` FROM `v2_currency_ledger`;
--> statement-breakpoint
DROP TABLE `v2_currency_ledger`;
--> statement-breakpoint
ALTER TABLE `v2_currency_ledger_new` RENAME TO `v2_currency_ledger`;
--> statement-breakpoint
CREATE INDEX `v2_currency_ledger_user_idx` ON `v2_currency_ledger` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_currency_ledger_idempotency_unique` ON `v2_currency_ledger` (`idempotency_key`);
