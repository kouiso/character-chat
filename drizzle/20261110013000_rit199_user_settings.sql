CREATE TABLE `v2_user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`safe_mode` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
