-- SQLite/D1 は「ALTER TABLE ADD COLUMN ... UNIQUE」を拒否する（Cannot add a UNIQUE column）。
-- 列追加と UNIQUE インデックス作成に分割し、同じ一意制約を担保する（fresh apply 互換）。
-- 既適用の環境（本番等）は d1_migrations にファイル名で記録済みのため再実行されない。
ALTER TABLE character ADD COLUMN slug text;
CREATE UNIQUE INDEX IF NOT EXISTS character_slug_idx ON character (slug);
