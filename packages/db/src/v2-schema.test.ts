// 元の DDL と加算 migration を両方見て、v2-schema.ts の列追加とのずれを防ぐ。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  v2ChunkTable,
  v2ChunkRejectionTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MemoryTable,
  v2MessageTable,
  v2TurnDeliveryTable,
  v2TurnCommitTable,
  v2ModelAttemptAuditTable,
} from "./v2-schema";

const SQL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../drizzle/0070_v2_tables.sql",
);

type ParsedTable = { name: string; columns: string[] };

// CREATE TABLE 本体は1列1行で、CHECK(...) は同じ行に inline されて "))," で閉じる
// （"..." のパターンで閉じるのは outer paren だけ）ので、非貪欲マッチで安全に切れる。
const parseSql = (sql: string): ParsedTable[] => {
  const tables: ParsedTable[] = [];
  const tableRe = /CREATE TABLE(?: IF NOT EXISTS)? `?(\w+)`?\s*\(([\S\s]*?)\n\);/g;
  for (const match of sql.matchAll(tableRe)) {
    const [, name, body] = match;
    if (!name || body === undefined) continue;
    const columns = body
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.length > 0)
      .filter((line) => !/^primary key/i.test(line))
      .filter((line) => !/^foreign key/i.test(line))
      .filter((line) => !/^constraint/i.test(line))
      .map((line) => line.split(/\s+/)[0].replace(/`/g, ""));
    tables.push({ name, columns });
  }
  return tables;
};

describe("v2_ tables: SQL DDL と drizzle 宣言の一致", () => {
  const sql = readFileSync(SQL_PATH, "utf8");
  const parsedTables = parseSql(sql);
  const migration = readFileSync(
    new URL("../../../drizzle/0076_v2_chunk_scheduled_at.sql", import.meta.url),
    "utf8",
  );
  for (const match of migration.matchAll(/ALTER TABLE `(\w+)` ADD `(\w+)`/g)) {
    parsedTables.find((table) => table.name === match[1])?.columns.push(match[2]);
  }
  const auditMigration = readFileSync(
    new URL("../../../drizzle/0082_v2_generation_attempt.sql", import.meta.url),
    "utf8",
  );
  for (const match of auditMigration.matchAll(/ALTER TABLE `(\w+)` ADD `(\w+)`/g)) {
    parsedTables.find((table) => table.name === match[1])?.columns.push(match[2]);
  }
  parsedTables.push(
    ...parseSql(
      readFileSync(
        new URL("../../../drizzle/0077_v2_chunk_rejection.sql", import.meta.url),
        "utf8",
      ),
    ),
  );
  parsedTables.push(
    ...parseSql(
      readFileSync(new URL("../../../drizzle/0078_v2_turn_delivery.sql", import.meta.url), "utf8"),
    ),
  );
  parsedTables.push(
    ...parseSql(
      readFileSync(new URL("../../../drizzle/0079_v2_turn_commit.sql", import.meta.url), "utf8"),
    ),
  );
  parsedTables.push(
    ...parseSql(
      readFileSync(
        new URL("../../../drizzle/0083_v2_model_attempt_audit.sql", import.meta.url),
        "utf8",
      ),
    ),
  );
  const parsedByName = new Map(parsedTables.map((t) => [t.name, t]));

  const drizzleTables = [
    v2ConversationTable,
    v2MessageTable,
    v2ChunkTable,
    v2ChunkRejectionTable,
    v2LedgerTable,
    v2GenerationTable,
    v2MemoryTable,
    v2TurnDeliveryTable,
    v2TurnCommitTable,
    v2ModelAttemptAuditTable,
  ];

  it("SQL 側に10個の v2_ テーブルが存在する", () => {
    expect(parsedTables.map((t) => t.name).sort()).toEqual(
      [
        "v2_chunk",
        "v2_chunk_rejection",
        "v2_conversation",
        "v2_generation",
        "v2_ledger",
        "v2_memory",
        "v2_turn_delivery",
        "v2_turn_commit",
        "v2_model_attempt_audit",
        "v2_message",
      ].sort(),
    );
  });

  const cases = drizzleTables.map((table) => [getTableName(table), table] as const);

  it.each(cases)("%s", (tableName, table) => {
    const parsed = parsedByName.get(tableName);
    expect(parsed, `drizzle テーブル ${tableName} が SQL に無い`).toBeDefined();

    const drizzleColumns = Object.values(getTableColumns(table))
      .map((column) => column.name)
      .sort();
    const sqlColumns = [...(parsed?.columns ?? [])].sort();

    expect(drizzleColumns).toEqual(sqlColumns);
  });
});
