import { describe, expect, it } from "vitest";

import {
  buildCatalogSyncSql,
  CATALOG_TABLES,
  type CatalogTableData,
} from "./db-sync";

describe("buildCatalogSyncSql", () => {
  it("emits INSERT OR REPLACE for every row of a table", () => {
    const tables: CatalogTableData[] = [
      {
        name: "scene_location",
        rows: [
          { id: "loc-1", name_jp: "教室", created_at: 1000 },
          { id: "loc-2", name_jp: "保健室", created_at: 2000 },
        ],
      },
    ];

    const sql = buildCatalogSyncSql(tables);

    expect(sql).toEqual([
      "INSERT OR REPLACE INTO scene_location (id, name_jp, created_at) VALUES ('loc-1', '教室', 1000);",
      "INSERT OR REPLACE INTO scene_location (id, name_jp, created_at) VALUES ('loc-2', '保健室', 2000);",
    ]);
  });

  it("orders parent tables before their children (FK-safe order)", () => {
    // 入力は子→親の逆順で与え、出力が親→子に並び替えられることを確認する
    const tables: CatalogTableData[] = [
      { name: "wardrobe_outfit_tag", rows: [{ outfit_id: "o-1", tag: "skirt" }] },
      { name: "wardrobe_outfit", rows: [{ id: "o-1", character_id: "c-1", name: "制服", is_default: 1, created_at: 5 }] },
      { name: "character_visual", rows: [{ character_id: "c-1", hair_color: "black", updated_at: 9 }] },
      { name: "character", rows: [{ id: "c-1", user_id: "u-1", name: "桜", created_at: 1 }] },
    ];

    const sql = buildCatalogSyncSql(tables);
    const tableOrder = sql.map((s) => s.match(/INTO (\w+)/)?.[1]);

    // character は全 character_* / wardrobe_* より前
    expect(tableOrder.indexOf("character")).toBeLessThan(
      tableOrder.indexOf("character_visual"),
    );
    expect(tableOrder.indexOf("character")).toBeLessThan(
      tableOrder.indexOf("wardrobe_outfit"),
    );
    // wardrobe_outfit は wardrobe_outfit_tag より前（孫の前に子）
    expect(tableOrder.indexOf("wardrobe_outfit")).toBeLessThan(
      tableOrder.indexOf("wardrobe_outfit_tag"),
    );
  });

  it("escapes single quotes and serializes NULL / numbers correctly", () => {
    const tables: CatalogTableData[] = [
      {
        name: "character",
        rows: [
          {
            id: "c-1",
            name: "O'Brien",
            user_id: "u-1",
            avatar: null,
            display_order: 0,
            created_at: 1718000000,
          },
        ],
      },
    ];

    const sql = buildCatalogSyncSql(tables);

    expect(sql[0]).toBe(
      "INSERT OR REPLACE INTO character (id, name, user_id, avatar, display_order, created_at) " +
        "VALUES ('c-1', 'O''Brien', 'u-1', NULL, 0, 1718000000);",
    );
  });

  it("skips tables with no rows", () => {
    const tables: CatalogTableData[] = [
      { name: "character", rows: [] },
      { name: "scene_location", rows: [{ id: "loc-1", name_jp: "海", created_at: 1 }] },
    ];

    const sql = buildCatalogSyncSql(tables);

    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("INTO scene_location");
  });

  it("places unknown tables after all known catalog tables", () => {
    const tables: CatalogTableData[] = [
      { name: "some_future_table", rows: [{ id: "x" }] },
      { name: "character", rows: [{ id: "c-1", user_id: "u-1", name: "桜", created_at: 1 }] },
    ];

    const sql = buildCatalogSyncSql(tables);
    const tableOrder = sql.map((s) => s.match(/INTO (\w+)/)?.[1]);

    expect(tableOrder.indexOf("character")).toBeLessThan(
      tableOrder.indexOf("some_future_table"),
    );
  });

  it("returns an empty array when given no tables", () => {
    expect(buildCatalogSyncSql([])).toEqual([]);
  });
});

describe("CATALOG_TABLES", () => {
  it("excludes per-user and runtime tables", () => {
    const names = CATALOG_TABLES.map((t) => t.name);
    for (const excluded of [
      "user",
      "conversation",
      "message",
      "scene_bookmark",
      "conversation_scene_state",
      "request_counter",
    ]) {
      expect(names).not.toContain(excluded);
    }
  });

  it("includes the core character-catalog tables", () => {
    const names = CATALOG_TABLES.map((t) => t.name);
    for (const included of [
      "character",
      "character_visual",
      "scene_location",
      "character_sub_image",
    ]) {
      expect(names).toContain(included);
    }
  });

  it("declares children with a higher order than their parent", () => {
    const orderOf = new Map(CATALOG_TABLES.map((t) => [t.name, t.order]));
    // 親が子より小さい order を持つこと（FK 安全な適用順の前提）
    expect(orderOf.get("character")!).toBeLessThan(orderOf.get("character_visual")!);
    expect(orderOf.get("scene_location")!).toBeLessThan(orderOf.get("scene_location_tag")!);
    expect(orderOf.get("wardrobe_outfit")!).toBeLessThan(orderOf.get("wardrobe_outfit_tag")!);
  });
});
