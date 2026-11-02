-- 0007/0042/0070/0075/0076/0079 の適用済みDDLを二重実行せず、生成snapshotだけを採用する。
-- pnpm db:generate で検出されたDDLは既存migrationと一致するため適用しない。
SELECT 1;
