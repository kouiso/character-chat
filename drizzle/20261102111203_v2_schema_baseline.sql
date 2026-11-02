-- 0070/0075/0076/0079 の適用済みDDLを二重実行せず、生成snapshotだけを採用する。
-- pnpm db:generate --name=v2_schema_baseline の記憶テーブルDDLは0079と一致している。
SELECT 1;