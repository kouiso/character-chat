import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const qualityReportDedupTable = sqliteTable("quality_report_dedup", {
  conversationId: text("conversation_id").primaryKey(),
  lastReportedAt: integer("last_reported_at", { mode: "number" }).notNull(),
});
