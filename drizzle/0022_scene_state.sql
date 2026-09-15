CREATE TABLE IF NOT EXISTS scene_location (
  id TEXT PRIMARY KEY NOT NULL,
  name_jp TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scene_location_tag (
  location_id TEXT NOT NULL REFERENCES scene_location(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (location_id, tag)
);
CREATE TABLE IF NOT EXISTS conversation_scene_state (
  conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  location_id TEXT REFERENCES scene_location(id),
  current_outfit_id TEXT,
  undress_level TEXT NOT NULL DEFAULT 'clothed',
  mate_present INTEGER NOT NULL DEFAULT 0,
  last_pose TEXT,
  last_camera TEXT,
  mood TEXT,
  updated_at INTEGER NOT NULL,
  background_tag TEXT
);
CREATE TABLE IF NOT EXISTS conversation_scene_body_fluid (
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (conversation_id, tag)
);
