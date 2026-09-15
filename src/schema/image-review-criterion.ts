import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 採点の重み付けをAIエンジニアリング学習データとして貯める子テーブル（migration 0050）。
// image_review 1行に criterion 別の重み・パネル点・局長点を多対1で持ち、
// 「どの観点が最も落ちやすいか」を集計してメタプロンプト・自動キャラ生成導線を改善する。
export const imageReviewCriterionTable = sqliteTable(
  "image_review_criterion",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reviewId: integer("review_id").notNull(),
    // identity_body / touch / anatomy_physics / expected_situation / sexual_expression / personality
    criterionKey: text("criterion_key").notNull(),
    // 正規化重み（criterion 合計 1.0）
    weight: real("weight").notNull(),
    panelScore: integer("panel_score", { mode: "number" }),
    directorScore: integer("director_score", { mode: "number" }),
    // 1 = 致命的破綻（腕本数・別人化）で総合を ≤2 にキャップする veto フラグ
    isVeto: integer("is_veto", { mode: "number" }).notNull().default(0),
    comment: text("comment"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("image_review_criterion_review_idx").on(t.reviewId),
    index("image_review_criterion_key_idx").on(t.criterionKey),
  ],
);
