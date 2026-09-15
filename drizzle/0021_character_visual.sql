CREATE TABLE IF NOT EXISTS character_visual (
  character_id  TEXT PRIMARY KEY NOT NULL,
  hair_color    TEXT NOT NULL,
  hair_style    TEXT NOT NULL,
  hair_length   TEXT NOT NULL,
  eye_color     TEXT NOT NULL,
  skin_tone     TEXT NOT NULL,
  body_type     TEXT NOT NULL,
  breast_size   TEXT,
  height_band   TEXT,
  age_apparent  INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (character_id) REFERENCES character(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_distinctive_mark (
  character_id  TEXT NOT NULL,
  tag           TEXT NOT NULL,
  PRIMARY KEY (character_id, tag),
  FOREIGN KEY (character_id) REFERENCES character(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_default_outfit_tag (
  character_id  TEXT NOT NULL,
  tag           TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1.0,
  ord           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, tag),
  FOREIGN KEY (character_id) REFERENCES character(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_undress_progression (
  character_id  TEXT NOT NULL,
  level         TEXT NOT NULL,
  tag           TEXT NOT NULL,
  PRIMARY KEY (character_id, level, tag),
  FOREIGN KEY (character_id) REFERENCES character(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS character_distinctive_mark_char_idx ON character_distinctive_mark(character_id);
CREATE INDEX IF NOT EXISTS character_default_outfit_tag_char_idx ON character_default_outfit_tag(character_id);
CREATE INDEX IF NOT EXISTS character_undress_progression_char_idx ON character_undress_progression(character_id);
