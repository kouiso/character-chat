ALTER TABLE `v2_conversation` ADD `legacy_source_user_id` text;
--> statement-breakpoint
UPDATE v2_conversation
SET legacy_source_user_id = (
  SELECT user_id FROM conversation WHERE conversation.id = v2_conversation.id
)
WHERE prompt_version = 'legacy-import-v1';