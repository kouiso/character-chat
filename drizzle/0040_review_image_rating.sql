CREATE TABLE IF NOT EXISTS `review_image_rating` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `r2_key` text NOT NULL UNIQUE,
  `verdict` text NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `rater_email` text NOT NULL DEFAULT '',
  `updated_at` integer NOT NULL
);
CREATE INDEX IF NOT EXISTS `review_image_rating_verdict_idx` ON `review_image_rating` (`verdict`);
