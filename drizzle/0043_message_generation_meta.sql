-- 生成メタデータ: リトライ回数・拒否検知フラグ・使用モデルを message テーブルに追加
ALTER TABLE message ADD COLUMN retry_count INTEGER;
ALTER TABLE message ADD COLUMN refusal_detected INTEGER;
ALTER TABLE message ADD COLUMN generation_model TEXT;
