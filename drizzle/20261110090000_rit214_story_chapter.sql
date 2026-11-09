CREATE TABLE `v2_story` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`title` text NOT NULL,
	`worldview` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `idx_v2_story_user` ON `v2_story` (`user_id`);
CREATE TABLE `v2_chapter` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`ord` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`narration` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `v2_story`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_v2_chapter_story` ON `v2_chapter` (`story_id`,`ord`);
