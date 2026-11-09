ALTER TABLE `v2_message` ADD `branch_no` integer DEFAULT 0 NOT NULL;
ALTER TABLE `v2_message` ADD `active` integer DEFAULT 1 NOT NULL;
DROP INDEX `v2_message_conv_turn_role_idx`;
CREATE UNIQUE INDEX `v2_message_active_idx` ON `v2_message` (`conversation_id`,`turn`,`role`) WHERE `active` = 1;
CREATE UNIQUE INDEX `v2_message_branch_idx` ON `v2_message` (`conversation_id`,`turn`,`role`,`branch_no`);
