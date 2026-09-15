-- conversation_share テーブルに有効期限カラムを追加
ALTER TABLE `conversation_share` ADD `expires_at` integer;
