CREATE TABLE `message_feedback` (
  `message_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `conversation_id` text NOT NULL,
  `character_id` text NOT NULL,
  `rating` text NOT NULL,
  `message_content` text NOT NULL,
  `previous_user_content` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_feedback_user_rating_idx` ON `message_feedback` (`user_id`,`rating`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `message_feedback_character_idx` ON `message_feedback` (`character_id`,`updated_at`);
