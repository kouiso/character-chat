-- 画像履歴方式: ユーザーには archived_at IS NULL の最新だけ表示し、
-- 差し替え時は行を DELETE せず archived_at を打つ。R2 オブジェクトは削除しない。
ALTER TABLE character_sub_image ADD COLUMN archived_at integer;
