-- memory_note に手編集時刻カラムを追加。手編集済みノートを source_message_id から切り離して保護するため。
ALTER TABLE `memory_note` ADD `edited_at` integer;
