ALTER TABLE `v2_group_message` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `v2_message` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `v2_message` ADD `upstream_id` text;