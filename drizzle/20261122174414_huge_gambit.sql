ALTER TABLE `v2_user_settings` ADD `notify_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_user_settings` ADD `notify_proactive` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_user_settings` ADD `notify_feed` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_user_settings` ADD `notify_call` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_user_settings` ADD `notify_anniversary` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `v2_user_settings` ADD `notify_hide_text` integer DEFAULT 1 NOT NULL;