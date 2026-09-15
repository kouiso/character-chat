-- 夜行バスの Novita 生成画像 3枚を削除。
-- pHash 比較で 3枚が酷似（Hamming 距離 8）かつ全て <1MB の低品質画像と判明。
-- 高品質版で差し替えるため、DB レコードのみ先行削除する。R2 ファイルは別途削除。

DELETE FROM `character_sub_image`
WHERE `character_id` = 'import-charap-yakobus'
  AND `r2_key` IN (
    'sub/import-charap-yakobus/yakobus-novita-flushed-moan.png',
    'sub/import-charap-yakobus/yakobus-novita-flushed-closeup.png',
    'sub/import-charap-yakobus/yakobus-novita-coy-invite.png'
  );

-- 削除後の ord を詰め直す（0-based 連番に再採番）。
-- SQLite には ROW_NUMBER が使えるため、一時テーブルを経由して更新する。
UPDATE `character_sub_image`
SET `ord` = (
  SELECT COUNT(*)
  FROM `character_sub_image` AS t2
  WHERE t2.`character_id` = 'import-charap-yakobus'
    AND t2.`id` < `character_sub_image`.`id`
)
WHERE `character_id` = 'import-charap-yakobus';
