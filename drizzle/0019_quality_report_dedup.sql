CREATE TABLE quality_report_dedup (
  conversation_id TEXT PRIMARY KEY,
  last_reported_at INTEGER NOT NULL
);
