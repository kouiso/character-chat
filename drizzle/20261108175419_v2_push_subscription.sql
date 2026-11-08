CREATE TABLE `v2_push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v2_push_subscription_endpoint_idx` ON `v2_push_subscription` (`endpoint`);--> statement-breakpoint
CREATE INDEX `v2_push_subscription_user_idx` ON `v2_push_subscription` (`user_id`);