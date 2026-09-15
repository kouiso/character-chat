CREATE TABLE IF NOT EXISTS request_counter (
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  counter_type TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period, counter_type)
);
