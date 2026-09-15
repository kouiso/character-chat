// drizzle/0070_v2_tables.sql の DDL と、v2-schema.ts の drizzle 宣言が
// テーブル名・列名でずれてへんことを機械的に確認する。手書き migration と
// drizzle-kit を使わん構成（journal が idx 64 で止まっとる）やから、
// この一致は人間がレビューで見るしかなかった。ここでテスト化する。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MemoryTable,
  v2MessageTable,
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
  const tableRe = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\S\s]*?)\n\);/g;
  for (const match of sql.matchAll(tableRe)) {
    const [, name, body] = match;
    if (!name || body === undefined) continue;
    const columns = body
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.length > 0)
      .filter((line) => !/^primary key/i.test(line))
      .map((line) => line.split(/\s+/)[0]);
    tables.push({ name, columns });
  }
  return tables;
};

describe("v2_ tables: SQL DDL と drizzle 宣言の一致", () => {
  const sql = readFileSync(SQL_PATH, "utf8");
  const parsedTables = parseSql(sql);
  const parsedByName = new Map(parsedTables.map((t) => [t.name, t]));

  const drizzleTables = [
    v2ConversationTable,
    v2MessageTable,
    v2ChunkTable,
    v2LedgerTable,
    v2GenerationTable,
    v2MemoryTable,
  ];

  it("SQL 側に6つの v2_ テーブルが存在する", () => {
    expect(parsedTables.map((t) => t.name).sort()).toEqual(
      [
        "v2_chunk",
        "v2_conversation",
        "v2_generation",
        "v2_ledger",
        "v2_memory",
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
