// 後続の ALTER TABLE も含め、適用済み D1 と drizzle 宣言を照合する。
import { getTableColumns, getTableName } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openLocalD1, type LocalD1 } from "./test/local-d1";
import {
  v2ChunkTable,
  v2ConversationTable,
  v2GenerationTable,
  v2LedgerTable,
  v2MemoryTable,
  v2MemoryJobTable,
  v2MemorySourceTable,
  v2MessageTable,
} from "./v2-schema";

describe("v2_ tables: SQL DDL と drizzle 宣言の一致", () => {
  let local: LocalD1;

  beforeAll(async () => {
    local = await openLocalD1();
  });

  afterAll(async () => {
    await local.dispose();
  });

  const drizzleTables = [
    v2ConversationTable,
    v2MessageTable,
    v2ChunkTable,
    v2LedgerTable,
    v2GenerationTable,
    v2MemoryTable,
    v2MemoryJobTable,
    v2MemorySourceTable,
  ];

  it("SQL 側にすべての v2_ テーブルが存在する", async () => {
    const { results } = await local.d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'v2_*'")
      .all<{ name: string }>();
    expect(results.map((table) => table.name).sort()).toEqual(
      [
        "v2_chunk",
        "v2_conversation",
        "v2_generation",
        "v2_ledger",
        "v2_memory",
        "v2_memory_job",
        "v2_memory_source",
        "v2_message",
      ].sort(),
    );
  });

  const cases = drizzleTables.map((table) => [getTableName(table), table] as const);

  it.each(cases)("%s", async (tableName, table) => {
    const { results } = await local.d1
      .prepare(`PRAGMA table_info(${tableName})`)
      .all<{ name: string }>();
    expect(results.length, `drizzle テーブル ${tableName} が SQL に無い`).toBeGreaterThan(0);

    const drizzleColumns = Object.values(getTableColumns(table))
      .map((column) => column.name)
      .sort();
    const sqlColumns = results.map((column) => column.name).sort();

    expect(drizzleColumns).toEqual(sqlColumns);
  });
});
