-- 「イマイチ」フィードバックの減点理由（定型 or 自由記述）を保存する列。任意・後方互換（nullable）。
ALTER TABLE message_feedback ADD COLUMN reason text;
