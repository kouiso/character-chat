import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const reviewImageRatingTable = sqliteTable(
  "review_image_rating",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    r2Key: text("r2_key").notNull().unique(),
    verdict: text("verdict").notNull(),
    note: text("note").notNull().default(""),
    raterEmail: text("rater_email").notNull().default(""),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("review_image_rating_verdict_idx").on(t.verdict)],
);
