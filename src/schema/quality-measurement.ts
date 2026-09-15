import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { promptVariantTable } from "./prompt-variant";

export const qualityMeasurementTable = sqliteTable(
  "quality_measurement",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id"),
    variantId: text("variant_id")
      .notNull()
      .references(() => promptVariantTable.id),
    slot: text("slot").notNull(),
    phase: text("phase").notNull(),
    isShadow: integer("is_shadow").notNull(),
    model: text("model"),
    // 1=judge verdict取得、0=意図的skip、NULL=judge呼び出し失敗。
    // NULL行は昇格集計から除外し、外部障害がcandidateを押し上げないようにする。
    judgeRan: integer("judge_ran"),
    judgePass: integer("judge_pass"),
    judgeReason: text("judge_reason"),
    deterministicPass: integer("deterministic_pass").notNull(),
    deterministicCategory: text("deterministic_category"),
    // どのチェックで落ちたかの詳細キー。detinistic_category だけでは複数チェックが同じ
    // カテゴリに集約されるため、リトライ・プロンプト改善の優先順位を付けるために残す。
    failedCheck: text("failed_check"),
    charLength: integer("char_length").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("quality_measurement_variant_created_idx").on(table.variantId, table.createdAt),
    index("quality_measurement_slot_shadow_created_idx").on(
      table.slot,
      table.isShadow,
      table.createdAt,
    ),
  ],
);
