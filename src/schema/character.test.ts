/**
 * Unit tests for src/schema/character.ts
 * Validates the Drizzle table column definitions, especially the nullable
 * imageMeta JSON column introduced in the avatars overhaul (#177).
 *
 * We test the TypeScript-level shape expectations, not the SQLite runtime,
 * so these tests run purely in jsdom / Node.
 *
 * Added in #185 test-infra initiative.
 */

import { describe, expect, it } from "vitest";

import { characterTable } from "./character";

// ─── helper: extract column info from Drizzle SQLiteTable ────────────────────

type ColConfig = {
  name: string;
  dataType?: string;
  notNull?: boolean;
  hasDefault?: boolean;
  primary?: boolean;
};

// Drizzle stores column metadata under the `_` symbol key.
// This helper makes the metadata inspectable without importing Drizzle internals.
const getColumns = (table: object): Record<string, ColConfig> => {
  const cols: Record<string, ColConfig> = {};
  for (const [key, value] of Object.entries(table)) {
    if (value && typeof value === "object" && "name" in value) {
      const col = value as {
        name: string;
        dataType?: string;
        notNull?: boolean;
        hasDefault?: boolean;
        primary?: boolean;
      };
      cols[key] = {
        name: col.name,
        dataType: col.dataType,
        notNull: col.notNull,
        hasDefault: col.hasDefault,
        primary: col.primary,
      };
    }
  }
  return cols;
};

describe("characterTable schema", () => {
  const cols = getColumns(characterTable);

  // migration 0032 が既存全件を is_official=1 にした結果、221件中220件が「公式」になった。
  // 以後に作られる/取り込まれるキャラが同じ道を通らんよう、既定値が false であることを固定する（issue #920）
  it("is_official の既定値は false で、明示せん限り公式にならない", () => {
    expect(characterTable.isOfficial.default).toBe(false);
    expect(cols["isOfficial"]?.name).toBe("is_official");
    expect(cols["isOfficial"]?.hasDefault).toBe(true);
  });

  it("has an id primary key column", () => {
    expect(cols["id"]).toBeDefined();
    expect(cols["id"]?.primary).toBe(true);
  });

  it("has required notNull columns: userId, name, systemPrompt, greeting", () => {
    for (const colKey of ["userId", "name", "systemPrompt", "greeting"] as const) {
      expect(cols[colKey]?.notNull).toBe(true);
    }
  });

  it("has nullable imageMeta column (not notNull)", () => {
    const imageMetaCol = cols["imageMeta"];
    expect(imageMetaCol).toBeDefined();
    // Drizzle nullable columns have notNull = false / undefined
    expect(imageMetaCol?.notNull).toBeFalsy();
  });

  it("has nullable visualPrompt column", () => {
    const col = cols["visualPrompt"];
    expect(col).toBeDefined();
    expect(col?.notNull).toBeFalsy();
  });

  it("has displayOrder column with default value", () => {
    const col = cols["displayOrder"];
    expect(col).toBeDefined();
    expect(col?.hasDefault).toBe(true);
  });

  it("has tags column", () => {
    expect(cols["tags"]).toBeDefined();
    expect(cols["tags"]?.notNull).toBe(true);
  });

  it("column name mapping: userId maps to user_id", () => {
    expect(cols["userId"]?.name).toBe("user_id");
  });

  it("column name mapping: imageMeta maps to image_meta", () => {
    expect(cols["imageMeta"]?.name).toBe("image_meta");
  });

  it("column name mapping: visualPrompt maps to visual_prompt", () => {
    expect(cols["visualPrompt"]?.name).toBe("visual_prompt");
  });
});

// ─── imageMeta runtime shape tests ───────────────────────────────────────────
// These validate the TypeScript type contract by checking that objects matching
// the expected shape are accepted — no SQLite I/O required.

type ImageMeta = {
  appearance: string;
  artStyle: string;
  outfit?: string;
  negativePrompt?: string;
};

const isValidImageMeta = (value: unknown): value is ImageMeta => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["appearance"] === "string" && typeof v["artStyle"] === "string";
};

describe("imageMeta shape validation", () => {
  it("accepts minimal valid imageMeta (appearance + artStyle only)", () => {
    const meta: unknown = {
      appearance: "brown hair, blue eyes, slender",
      artStyle: "anime, masterpiece",
    };
    expect(isValidImageMeta(meta)).toBe(true);
  });

  it("accepts full imageMeta with outfit and negativePrompt", () => {
    const meta: unknown = {
      appearance: "silver hair, red eyes",
      artStyle: "anime, detailed",
      outfit: "school uniform",
      negativePrompt: "ugly, deformed",
    };
    expect(isValidImageMeta(meta)).toBe(true);
  });

  it("rejects null imageMeta", () => {
    expect(isValidImageMeta(null)).toBe(false);
  });

  it("rejects imageMeta missing artStyle", () => {
    expect(isValidImageMeta({ appearance: "brown hair" })).toBe(false);
  });

  it("rejects imageMeta missing appearance", () => {
    expect(isValidImageMeta({ artStyle: "anime" })).toBe(false);
  });

  it("rejects non-object imageMeta", () => {
    expect(isValidImageMeta("string")).toBe(false);
    expect(isValidImageMeta(42)).toBe(false);
    expect(isValidImageMeta(undefined)).toBe(false);
  });
});
