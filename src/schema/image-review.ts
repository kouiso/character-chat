import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// キャラ仕上げ工程v2の審査レコード（prompt/instructions/char-approval-process.md）。
// 1画像（r2_key）に作り直しラウンドごとの審査行が複数付くため、
// review_image_rating（r2_key unique・最終裁定のみ）とは別テーブル。
// character_sub_image は最終採用状態のみを持ち、審査履歴はこちらに集約する。
export const imageReviewTable = sqliteTable(
  "image_review",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    r2Key: text("r2_key").notNull(),
    characterId: text("character_id").notNull(),
    label: text("label").notNull(),
    round: integer("round", { mode: "number" }).notNull().default(1),
    // 提示時必須:「どういう意図で吐き出したか」
    intentComment: text("intent_comment").notNull(),
    // 審査員パネル4軸（同一性/人体構造/シチュ整合/抜き体験）の評価JSON
    aiPanelJson: text("ai_panel_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
    directorScore: integer("director_score", { mode: "number" }),
    directorComment: text("director_comment"),
    verdict: text("verdict").notNull().default("pending"),
    imageModel: text("image_model"),
    seed: integer("seed", { mode: "number" }),
    prompt: text("prompt"),
    // 生成時パラメータの完全記録（strength/steps/sampler/guidance/サイズ/段構成/提供元）。
    // タッチ再現とモデル追跡のため、生成した瞬間に必ず入れる（後付けバックフィル禁止）。
    genParams: text("gen_params", { mode: "json" }).$type<Record<string, unknown> | null>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("image_review_char_idx").on(t.characterId, t.createdAt),
    index("image_review_r2_key_idx").on(t.r2Key),
    index("image_review_verdict_idx").on(t.verdict),
  ],
);
