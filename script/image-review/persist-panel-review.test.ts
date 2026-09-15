import { describe, expect, it } from "vitest";

import { buildPersistPanelReviewPlan } from "./persist-panel-review";
import type { PanelImageResult, TouchClasses } from "../../src/lib/image-review-panel";

const touch: TouchClasses = {
  specular: "soft",
  shading: "gradient",
  lineArt: "thin",
  saturation: "moderate",
  colourTemperature: "cool",
};

const panel = (label: string): PanelImageResult => ({
  label,
  intent: "normal",
  scores: {
    identity_body: 8,
    touch: 8,
    anatomy_physics: 8,
    expected_situation: 8,
    sexual_expression: 0,
    personality: 8,
  },
  lensEvidence: {
    identity_body: "顔と体格が一致",
    touch: "線と陰影が一致",
    anatomy_physics: "四肢が自然",
    expected_situation: "テーマ通り",
    sexual_expression: "normal のため採点対象外",
    personality: "表情が人格通り",
  },
  touchComparison: { reference: touch, candidate: touch },
  trademarkComparison: {
    reference: { structureClass: "hard split", ratio: "50/50" },
    candidate: { structureClass: "hard split", ratio: "70/30" },
  },
  fatalAnatomyDefects: [],
  fatalIdentityDiscontinuities: [],
});

const image = (label: string, r2Key: string) => ({
  r2Key,
  characterId: "char",
  round: 1,
  intentComment: "日常写真",
  createdAt: 1_700_000_000_000,
  panel: panel(label),
});

describe("buildPersistPanelReviewPlan", () => {
  it("pending の親行と6件のcriterion行を作る", () => {
    const result = buildPersistPanelReviewPlan({ images: [image("A", "review/char/A.jpg")] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain("'pending'");
    expect(result.sql.match(/INSERT INTO image_review_criterion/g)).toHaveLength(6);
    expect(result.reviewRows[0].panelVerdict).toBe("pass");
    expect(result.reviewRows[0].verdict).toBe("pending");
  });

  // D1 は SQL の BEGIN / SAVEPOINT を拒否する（wrangler 4.76.0 実測）。
  // 明示トランザクション文を1つでも混ぜると --execute が INSERT 前に落ちる。
  it("D1 が受け付けん明示トランザクション文を出さん", () => {
    const result = buildPersistPanelReviewPlan({ images: [image("A", "review/char/A.jpg")] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).not.toMatch(/\bBEGIN\b/i);
    expect(result.sql).not.toMatch(/\bCOMMIT\b/i);
    expect(result.sql).not.toMatch(/\bSAVEPOINT\b/i);
    expect(result.sql).not.toMatch(/\bROLLBACK\b/i);
    // 親行と criterion 行は同一 batch に載る（wrangler が複文を D1 batch へ渡す）。
    expect(result.sql.split(";\n").length).toBeGreaterThan(1);
  });

  it("不正なパネルはSQLを作らず差し戻す", () => {
    const broken = { ...panel("B"), intent: undefined };
    const result = buildPersistPanelReviewPlan({
      images: [{ ...image("B", "review/char/B.jpg"), panel: broken }],
    });
    expect(result.ok).toBe(false);
  });

  // ラベルが重複したまま Map を作ると後勝ちで1件だけ残り、
  // 両方の親行が同じ r2Key で書かれ、criterion 行も両方へ二重に付く。
  // 差し戻すのは先に走る aggregatePanelReview。この境界がそれを素通ししてへんことを固定する。
  it("ラベル重複はSQLを作らず差し戻す", () => {
    const result = buildPersistPanelReviewPlan({
      images: [image("A", "review/char/A1.jpg"), image("A", "review/char/A2.jpg")],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("ラベルが提出内で重複");
  });
});
