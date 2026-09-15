CREATE TABLE IF NOT EXISTS wardrobe_outfit (
  id TEXT PRIMARY KEY NOT NULL,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wardrobe_outfit_tag (
  outfit_id TEXT NOT NULL REFERENCES wardrobe_outfit(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (outfit_id, tag)
);
CREATE TABLE IF NOT EXISTS wardrobe_outfit_occasion (
  outfit_id TEXT NOT NULL REFERENCES wardrobe_outfit(id) ON DELETE CASCADE,
  occasion TEXT NOT NULL,
  PRIMARY KEY (outfit_id, occasion)
);
