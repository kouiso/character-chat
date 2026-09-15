-- Fix C: 夜行バス bare window → dark window（冪等）
DELETE FROM scene_location_tag WHERE location_id = 'night_bus' AND tag = 'window';

INSERT OR IGNORE INTO scene_location_tag (location_id, tag) VALUES
  ('night_bus', 'dark window'),
  ('night_bus', 'night scenery outside window'),
  ('night_bus', 'low-key lighting');
