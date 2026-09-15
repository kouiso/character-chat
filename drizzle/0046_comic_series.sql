-- #597: 章立て長編コミック用 series_id / chapter_ord 列追加（nullable・後方互換）
ALTER TABLE comic ADD COLUMN series_id TEXT;
ALTER TABLE comic ADD COLUMN chapter_ord INTEGER;
