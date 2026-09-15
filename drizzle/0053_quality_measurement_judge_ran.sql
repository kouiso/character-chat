-- judge_pass=NULL だけでは意図的skipと外部judge障害を区別できない。
-- 1=verdict取得、0=意図的skip、NULL=judge障害として記録する。
ALTER TABLE quality_measurement ADD COLUMN judge_ran INTEGER;

-- 既存行はjudge_passの有無から復元する。過去のNULLは障害か意図的skipか
-- 区別不能なため、従来挙動を保つ意図的skipとして扱う。
UPDATE quality_measurement
SET judge_ran = CASE WHEN judge_pass IS NULL THEN 0 ELSE 1 END;
