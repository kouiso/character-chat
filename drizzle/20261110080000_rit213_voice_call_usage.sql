CREATE TABLE `v2_voice_call_usage` (
	`user_id` text NOT NULL,
	`day_start` integer NOT NULL,
	`seconds` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day_start`)
);
