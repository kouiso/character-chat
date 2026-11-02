// 後続の ALTER TABLE も含め、適用済み D1 と drizzle 宣言を照合する。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { characterTable } from "../../../src/schema/character";
import { groupMessageTable } from "../../../src/schema/group";

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
  let persistRoot: string | undefined;

  beforeAll(async () => {
    // 他branchで適用済みのmigrationを混ぜず、このcheckoutのDDLを照合する。
    persistRoot = await mkdtemp(join(tmpdir(), "v2-schema-"));
    local = await openLocalD1({ persistRoot });
  });

  afterAll(async () => {
    await local?.dispose();
    if (persistRoot) await rm(persistRoot, { recursive: true, force: true });
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

  const cases = [...drizzleTables, characterTable, groupMessageTable].map(
    (table) => [getTableName(table), table] as const,
  );

  it("character slug uses the historical unique index", () => {
    expect(getTableColumns(characterTable).slug.isUnique).toBe(false);
  });

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

    const config = getTableConfig(table);
    const { results: indexes } = await local.d1
      .prepare(`PRAGMA index_list(${tableName})`)
      .all<{ name: string; unique: number; origin: string }>();
    expect(
      indexes
        .filter((index) => index.origin !== "pk")
        .map((index) => index.name)
        .sort(),
    ).toEqual(config.indexes.map((index) => index.config.name).sort());
    for (const index of config.indexes) {
      const actual = indexes.find((candidate) => candidate.name === index.config.name);
      expect(actual?.unique).toBe(index.config.unique ? 1 : 0);
      const { results: columns } = await local.d1
        .prepare(`PRAGMA index_info(${index.config.name})`)
        .all<{ name: string }>();
      expect(columns.map((column) => column.name)).toEqual(
        index.config.columns.map((column) => ("name" in column ? column.name : "expression")),
      );
    }

    const definition = await local.d1
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(tableName)
      .first<{ sql: string }>();
    const normalize = (sql: string) =>
      sql
        .replace(/["`]/g, "")
        .replace(/\b(?:v2_\w+|character|group_message)\./g, "")
        .replace(/\s+/g, "")
        .toLowerCase();
    const normalizedDefinition = normalize(definition?.sql ?? "");
    expect(normalizedDefinition.match(/check\(/g)?.length ?? 0).toBe(config.checks.length);
    const dialect = new SQLiteSyncDialect();
    for (const constraint of config.checks) {
      const expression = dialect.sqlToQuery(constraint.value).sql;
      expect(normalizedDefinition).toContain(`check(${normalize(expression)})`);
    }
  });
});
