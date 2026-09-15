-- #443: 生成メタデータ追加列（rawOutput/generationPhase/qualityMeta）
ALTER TABLE message ADD COLUMN raw_output TEXT;
ALTER TABLE message ADD COLUMN generation_phase TEXT;
ALTER TABLE message ADD COLUMN quality_meta TEXT;
