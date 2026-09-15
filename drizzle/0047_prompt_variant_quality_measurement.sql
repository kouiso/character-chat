-- drizzle-kit generate は 0008_snapshot.json 以降スナップショット未追従(0009〜0046は手書き運用)のため
-- rename衝突resolverがTTYを要求し非対話実行不可。schema.ts の内容をそのまま手書きSQL化する。
CREATE TABLE prompt_variant (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL,
  phase_scope TEXT NOT NULL,
  body TEXT NOT NULL,
  model_override TEXT,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'hand',
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX prompt_variant_slot_status_idx ON prompt_variant(slot, status);

CREATE TABLE quality_measurement (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  variant_id TEXT NOT NULL REFERENCES prompt_variant(id),
  slot TEXT NOT NULL,
  phase TEXT NOT NULL,
  is_shadow INTEGER NOT NULL,
  model TEXT,
  judge_pass INTEGER,
  judge_reason TEXT,
  deterministic_pass INTEGER NOT NULL,
  deterministic_category TEXT,
  char_length INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX quality_measurement_variant_created_idx ON quality_measurement(variant_id, created_at);
CREATE INDEX quality_measurement_slot_shadow_created_idx ON quality_measurement(slot, is_shadow, created_at);

CREATE TABLE promotion_log (
  id TEXT PRIMARY KEY,
  slot TEXT NOT NULL,
  from_variant_id TEXT,
  to_variant_id TEXT NOT NULL,
  champion_samples INTEGER NOT NULL,
  candidate_samples INTEGER NOT NULL,
  champion_pass_rate REAL NOT NULL,
  candidate_pass_rate REAL NOT NULL,
  decision TEXT NOT NULL,
  decided_at INTEGER NOT NULL
);

-- reason列は0047_message_feedback_reason.sql(別PR、ファイル名順でこのファイルより先に適用される)が
-- 既に追加している。同一列を二重ADD COLUMNすると新規環境でのmigration適用がSQLITE_ERRORで止まるため、
-- ここではvariant_idのみ追加する(実PR#799レビューで発見)。
ALTER TABLE message_feedback ADD COLUMN variant_id TEXT;
