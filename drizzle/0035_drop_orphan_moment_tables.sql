-- 0024_remove_social_tables は moment 本体だけ DROP し、moment_like / moment_report を残した。
-- これらは moment(id) への FK を持つ孤児テーブルで、user/character 削除の CASCADE 時に
-- "no such table: main.moment" を起こす（#580 ローカルDBリセット失敗の真因）。
-- SNS投稿(moment)機能は廃止のため、残骸テーブルを完全に削除して 0024 の意図を完結させる。
DROP TABLE IF EXISTS moment_like;
DROP TABLE IF EXISTS moment_report;
