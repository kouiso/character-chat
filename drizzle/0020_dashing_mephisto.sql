-- conversation_scene_state は後続の 0022_scene_state.sql で正式に作成される
-- かつ background_tag 列もそこで定義するため、この migration は no-op とする
SELECT 1;
