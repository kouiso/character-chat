import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const PROMPT_VARIANT_STATUS = ["champion", "candidate", "retired"] as const;
export type PromptVariantStatus = (typeof PROMPT_VARIANT_STATUS)[number];

export const PROMPT_VARIANT_PROVENANCE = ["hand", "auto"] as const;
export type PromptVariantProvenance = (typeof PROMPT_VARIANT_PROVENANCE)[number];

export const promptVariantTable = sqliteTable(
  "prompt_variant",
  {
    id: text("id").primaryKey(),
    slot: text("slot").notNull(),
    phaseScope: text("phase_scope").notNull(),
    body: text("body").notNull(),
    modelOverride: text("model_override"),
    status: text("status", { enum: PROMPT_VARIANT_STATUS }).notNull(),
    version: integer("version").notNull(),
    provenance: text("provenance", { enum: PROMPT_VARIANT_PROVENANCE }).notNull().default("hand"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("prompt_variant_slot_status_idx").on(table.slot, table.status),
    // 同一slotに複数championが並存するのを防ぐ部分ユニークインデックス(drizzle/0048)
    uniqueIndex("prompt_variant_slot_champion_unique_idx")
      .on(table.slot)
      .where(sql`${table.status} = 'champion'`),
  ],
);
