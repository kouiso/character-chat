-- prompt_variant テーブルに残っている「シーツ」を汎用布地表現に置換する。
-- これにより、ユーザーがソファ/カウンター等を指定している場面で勝手にベッド/シーツが出る学習データを除去する。
UPDATE prompt_variant
SET body = REPLACE(body, 'シーツ', '布地')
WHERE body LIKE '%シーツ%';
