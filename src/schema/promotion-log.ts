import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const promotionLogTable = sqliteTable("promotion_log", {
  id: text("id").primaryKey(),
  slot: text("slot").notNull(),
  fromVariantId: text("from_variant_id"),
  toVariantId: text("to_variant_id").notNull(),
  championSamples: integer("champion_samples").notNull(),
  candidateSamples: integer("candidate_samples").notNull(),
  championPassRate: real("champion_pass_rate").notNull(),
  candidatePassRate: real("candidate_pass_rate").notNull(),
  decision: text("decision").notNull(),
  decidedAt: integer("decided_at", { mode: "number" }).notNull(),
});
