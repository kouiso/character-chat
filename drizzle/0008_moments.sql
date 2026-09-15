CREATE TABLE moment (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('character_card', 'clip', 'comic', 'story')),
  ref_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'removed')),
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (author_id) REFERENCES user(id)
);
CREATE INDEX moment_status_visibility_created_at_idx ON moment(status, visibility, created_at);
CREATE INDEX moment_author_id_created_at_idx ON moment(author_id, created_at);
CREATE INDEX moment_type_created_at_idx ON moment(type, created_at);

CREATE TABLE moment_like (
  moment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (moment_id, user_id),
  FOREIGN KEY (moment_id) REFERENCES moment(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE moment_report (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (moment_id) REFERENCES moment(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_id) REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX moment_report_moment_id_idx ON moment_report(moment_id);
CREATE INDEX moment_report_reporter_id_idx ON moment_report(reporter_id);
CREATE UNIQUE INDEX moment_report_moment_id_reporter_id_uidx ON moment_report(moment_id, reporter_id);
