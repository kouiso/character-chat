-- #443: 会話ローリングサマリー列の追加（nullable・後方互換）
ALTER TABLE conversation ADD COLUMN rolling_summary TEXT;
ALTER TABLE conversation ADD COLUMN summary_updated_at INTEGER;
ALTER TABLE conversation ADD COLUMN sexual_state TEXT;
ALTER TABLE conversation ADD COLUMN scene_state TEXT;
