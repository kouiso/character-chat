-- キャラの所有表示を整理する（#1494）。
--
-- 局長が自分で作ったと表示してええのは 3 体だけで、残りは運営管理として出す。
-- 現状は 221 体中 220 体が is_official=1、char-aria01 だけが 0 という
-- 実態と食い違う状態やった。
--
-- LIKE やのうて id の完全一致で絞る。0072 が本番で
-- 「LIKE or GLOB pattern too complex」に当たった（drizzle/0072 のコメント参照）。

UPDATE character SET is_official = 1 WHERE is_official = 0;

UPDATE character
SET is_official = 0
WHERE id IN (
  'char-koharu-ex',
  'import-charap-ダウナーお姉さんに拾われる話',
  'import-charap-夜行バス隣の席のお姉さん'
);
