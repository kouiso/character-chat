-- 夜行バス車内 scene location（冪等）
INSERT OR IGNORE INTO scene_location (id, name_jp, created_at) VALUES ('night_bus', '夜行バス車内', 0);

INSERT OR IGNORE INTO scene_location_tag (location_id, tag) VALUES
  ('night_bus', 'intercity bus interior'),
  ('night_bus', 'reclining seat'),
  ('night_bus', 'dim lighting'),
  ('night_bus', 'night'),
  ('night_bus', 'window'),
  ('night_bus', 'indoors');

-- 夜行バスキャラの visual_prompt backfill（Tier3 経路用・冪等）
-- prod で imageMeta/character_visual が投入済みなら no-op。主軸は Layer1+3。
UPDATE character
SET visual_prompt = '1girl, solo, mature female, intercity overnight bus interior at night, dim cabin lighting, reclining bus seat, window with highway lights, sitting, indoors'
WHERE id = 'import-charap-夜行バス隣の席のお姉さん'
  AND (visual_prompt IS NULL OR visual_prompt = '');
