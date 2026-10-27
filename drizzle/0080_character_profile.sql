ALTER TABLE `character` ADD `introduction` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `example_dialogue` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `world` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `appearance` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `age` integer;--> statement-breakpoint
ALTER TABLE `character` ADD `adult_category` text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `proactive_settings` text DEFAULT '{"enabled":false,"intervalMinutes":60}' NOT NULL;