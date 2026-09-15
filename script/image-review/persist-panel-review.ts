import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  aggregatePanelReview,
  type AggregateRejection,
  type PanelCriterionRow,
  type PanelReviewRow,
} from "../../src/lib/image-review-aggregate";
import type { PanelImageResult } from "../../src/lib/image-review-panel";

export type PanelReviewImageInput = {
  r2Key: string;
  characterId: string;
  round: number;
  intentComment: string;
  imageModel?: string;
  seed?: number;
  prompt?: string;
  createdAt: number;
  panel: PanelImageResult;
};

export type PersistPanelReviewInput = {
  images: PanelReviewImageInput[];
  acceptedHistory?: PanelImageResult[];
};

export type PersistPanelReviewPlan =
  | AggregateRejection
  | {
      ok: true;
      sql: string;
      reviewRows: PanelReviewRow[];
      criterionRows: PanelCriterionRow[];
    };

const sqlText = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sqlNullableText = (value: string | undefined): string =>
  value === undefined ? "NULL" : sqlText(value);
const sqlNullableNumber = (value: number | undefined): string =>
  value === undefined ? "NULL" : String(value);

export const buildPersistPanelReviewPlan = (
  input: PersistPanelReviewInput,
): PersistPanelReviewPlan => {
  const aggregation = aggregatePanelReview(
    input.images.map((image) => image.panel),
    { acceptedHistory: input.acceptedHistory ?? [] },
  );
  if (!aggregation.ok) return aggregation;

  // ラベルは reviewRows と入力メタデータの突合キー。重複したまま Map を作ると
  // 後勝ちで1件だけ残り、両方の親行が同じ r2Key / characterId で書かれる。
  // 検出は上の aggregatePanelReview が持つ（同じラベル配列を見るので、ここに
  // 二重のガードを置いても到達せん＝ミューテーションで赤にならんことを確認済み）。
  const metadata = new Map(input.images.map((image) => [image.panel.label, image]));
  // D1 は SQL の BEGIN / SAVEPOINT を受け付けん（wrangler 4.76.0 実測:
  // "please use the state.storage.transaction() ... instead of the SQL BEGIN TRANSACTION"）。
  // 代わりに wrangler d1 execute が複文をまとめて D1 の batch へ渡し、batch が
  // 暗黙のトランザクションになる。親行と criterion 行の同時成立はそこで担保する。
  const statements: string[] = [];
  for (const review of aggregation.reviewRows) {
    const image = metadata.get(review.label);
    if (!image) return { ok: false, rejections: [`${review.label}: persistence metadata が無い`] };
    statements.push(
      `INSERT INTO image_review (` +
        `r2_key, character_id, label, round, intent_comment, ai_panel_json, ` +
        `director_score, director_comment, verdict, image_model, seed, prompt, created_at` +
        `) VALUES (` +
        [
          sqlText(image.r2Key),
          sqlText(image.characterId),
          sqlText(review.label),
          String(image.round),
          sqlText(image.intentComment),
          sqlText(review.aiPanelJson),
          "NULL",
          "NULL",
          sqlText("pending"),
          sqlNullableText(image.imageModel),
          sqlNullableNumber(image.seed),
          sqlNullableText(image.prompt),
          String(image.createdAt),
        ].join(", ") +
        `);`,
    );
    for (const criterion of aggregation.criterionRows.filter((row) => row.label === review.label)) {
      statements.push(
        `INSERT INTO image_review_criterion (` +
          `review_id, criterion_key, weight, panel_score, director_score, is_veto, comment, created_at` +
          `) SELECT id, ` +
          [
            sqlText(criterion.criterionKey),
            String(criterion.weight),
            String(criterion.panelScore),
            "NULL",
            String(criterion.isVeto),
            sqlText(criterion.comment),
            String(image.createdAt),
          ].join(", ") +
          ` FROM image_review WHERE r2_key = ${sqlText(image.r2Key)} ` +
          `AND label = ${sqlText(review.label)} AND round = ${image.round} ` +
          `ORDER BY id DESC LIMIT 1;`,
      );
    }
  }
  return {
    ok: true,
    sql: statements.join("\n"),
    reviewRows: aggregation.reviewRows,
    criterionRows: aggregation.criterionRows,
  };
};

const runCli = (): void => {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf("--input");
  if (inputIndex < 0 || !args[inputIndex + 1]) {
    throw new Error("usage: persist-panel-review --input <json> [--execute] [--remote]");
  }
  const input = JSON.parse(readFileSync(args[inputIndex + 1], "utf8")) as PersistPanelReviewInput;
  const plan = buildPersistPanelReviewPlan(input);
  if (!plan.ok) {
    process.stderr.write(`${plan.rejections.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  if (!args.includes("--execute")) {
    process.stdout.write(`${plan.sql}\n`);
    return;
  }
  const wranglerArgs = [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "adult-ai-db",
    ...(args.includes("--remote") ? ["--remote"] : ["--local"]),
    "--command",
    plan.sql,
  ];
  const result = spawnSync("pnpm", wranglerArgs, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
};

if (process.argv[1]?.endsWith("persist-panel-review.ts")) runCli();
