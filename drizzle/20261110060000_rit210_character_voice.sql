CREATE TABLE `v2_character_voice` (
	`character_id` text PRIMARY KEY NOT NULL,
	`engine` text NOT NULL,
	`speaker_id` text NOT NULL,
	`speed` real NOT NULL,
	`pitch` real NOT NULL,
	`intonation` real NOT NULL,
	`updated_at` integer NOT NULL
);
