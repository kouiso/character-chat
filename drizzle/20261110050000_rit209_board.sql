CREATE TABLE `v2_board_post` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_v2_board_post_created` ON `v2_board_post` (`created_at`);
