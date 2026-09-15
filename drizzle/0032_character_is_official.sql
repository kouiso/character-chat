ALTER TABLE character ADD COLUMN is_official integer NOT NULL DEFAULT 0;
UPDATE character SET is_official = 1;
