-- 採点の重み付けをAIエンジニアリング学習データとして貯める子テーブル（局長制定 2026-07-13）。
-- image_review 1行（1画像1ラウンド）に対し criterion 別の重み・パネル点・局長点・コメントを多対1で持つ。
-- これにより「どの観点が最も落ちやすいか」を集計してメタプロンプト/自動生成導線を改善できる。
CREATE TABLE IF NOT EXISTS image_review_criterion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  criterion_key TEXT NOT NULL,      -- identity_body / touch / anatomy_physics / expected_situation / sexual_expression / personality
  weight REAL NOT NULL,             -- 正規化重み（合計1.0）
  panel_score INTEGER,              -- 審査員パネルの0-10
  director_score INTEGER,           -- 局長の0-10（付いた場合）
  is_veto INTEGER NOT NULL DEFAULT 0, -- 1=致命的破綻(腕本数/別人化)で総合を≤2にキャップ
  comment TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS image_review_criterion_review_idx ON image_review_criterion(review_id);
CREATE INDEX IF NOT EXISTS image_review_criterion_key_idx ON image_review_criterion(criterion_key);
