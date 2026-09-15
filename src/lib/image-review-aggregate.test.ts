import { describe, expect, it } from "vitest";

import { aggregatePanelReview } from "./image-review-aggregate";
import {
  PANEL_CRITERION_KEYS,
  type PanelImageResult,
  type PanelScores,
  type TouchClasses,
} from "./image-review-panel";

const scores = (
  identity: number,
  touch: number,
  anatomy: number,
  situation: number,
  sexual: number,
  personality: number,
): PanelScores => ({
  identity_body: identity,
  touch,
  anatomy_physics: anatomy,
  expected_situation: situation,
  sexual_expression: sexual,
  personality,
});

const evidence = (suffix: string): Partial<Record<(typeof PANEL_CRITERION_KEYS)[number], string>> =>
  Object.fromEntries(PANEL_CRITERION_KEYS.map((key) => [key, `${key} の所見 ${suffix}`]));

const CANON_TOUCH: TouchClasses = {
  specular: "soft sheen",
  shading: "soft gradient",
  lineArt: "thin clean",
  saturation: "moderate",
  colourTemperature: "cool",
};

const healthy = (label: string): PanelImageResult => ({
  label,
  intent: "erotic",
  scores: scores(9, 8, 9, 8, 9, 7),
  lensEvidence: evidence(label),
  touchComparison: { reference: CANON_TOUCH, candidate: { ...CANON_TOUCH } },
  trademarkComparison: {
    reference: { structureClass: "ハードスプリット", ratio: "50/50" },
    candidate: { structureClass: "ハードスプリット", ratio: "50/50" },
  },
  fatalAnatomyDefects: [],
  fatalIdentityDiscontinuities: [],
});

describe("aggregatePanelReview", () => {
  it("健全な提出は 6キー分の criterion 行を書き出す", () => {
    const result = aggregatePanelReview([healthy("HA")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.criterionRows).toHaveLength(6);
    expect(result.reviewRows[0].verdict).toBe("pending");
    expect(result.reviewRows[0].panelVerdict).toBe("pass");
    // 4軸で書いて割り戻す形やと再発するので、6キーが個別に入っとることを見る
    const parsed = JSON.parse(result.reviewRows[0].aiPanelJson) as {
      criteria: Record<string, unknown>;
    };
    expect(Object.keys(parsed.criteria).sort()).toEqual([...PANEL_CRITERION_KEYS].sort());
  });

  it("根拠テキストが無い提出は書かせず差し戻す（count=1 の既定経路）", () => {
    const withoutEvidence: PanelImageResult = { label: "S", scores: scores(8, 8, 5, 6, 7, 8) };
    const result = aggregatePanelReview([withoutEvidence]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("レンズの根拠が無い");
  });

  it("根拠テキストが同一なら1枚でも複製として差し戻す", () => {
    const copied: PanelImageResult = {
      label: "S",
      scores: scores(8, 8, 5, 6, 7, 8),
      lensEvidence: {
        ...evidence("S"),
        touch: "同じ所見",
        identity_body: "同じ所見",
        personality: "同じ所見",
      },
    };
    const result = aggregatePanelReview([copied]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("複製");
  });

  it("独立に採点した結果がたまたま同点でも通す", () => {
    const tie: PanelImageResult = {
      ...healthy("T"),
      scores: scores(8, 8, 9, 7, 6, 8),
    };
    expect(aggregatePanelReview([tie]).ok).toBe(true);
  });

  it("スコアが欠けていたら NaN を書かずに差し戻す", () => {
    const broken = {
      label: "B",
      scores: { identity_body: 8, touch: 7 } as unknown as PanelScores,
      lensEvidence: evidence("B"),
    };
    const result = aggregatePanelReview([broken]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("が無い");
  });

  it("描画モデルが変わった候補だけを VETO する", () => {
    const drifted: PanelImageResult = {
      ...healthy("D"),
      touchComparison: {
        reference: CANON_TOUCH,
        candidate: { ...CANON_TOUCH, shading: "painterly" },
      },
    };
    const result = aggregatePanelReview([healthy("OK"), drifted]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...new Set(result.vetoFindings.map((f) => f.label))]).toEqual(["D"]);
    const rows = Object.fromEntries(result.reviewRows.map((r) => [r.label, r]));
    expect(rows["D"].isVeto).toBe(1);
    expect(rows["D"].panelVerdict).toBe("fail");
    // セット全体を巻き添えにせん
    expect(rows["OK"].isVeto).toBe(0);
    expect(rows["OK"].panelVerdict).toBe("pass");
  });

  it("照明だけの違いは VETO にせん（暖色の寝室シーン等）", () => {
    const warmScene: PanelImageResult = {
      ...healthy("W"),
      touchComparison: {
        reference: CANON_TOUCH,
        candidate: { ...CANON_TOUCH, colourTemperature: "warm" },
      },
    };
    const result = aggregatePanelReview([warmScene]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vetoFindings).toEqual([]);
    expect(result.reviewRows[0].panelVerdict).toBe("pass");
  });

  it("トレードマークの構造型が変わった候補だけを VETO する", () => {
    const trademarkDrift: PanelImageResult = {
      ...healthy("M"),
      trademarkComparison: {
        reference: { structureClass: "ハードスプリット", ratio: "50/50" },
        candidate: { structureClass: "黒筋", ratio: "ほぼ銀" },
      },
    };
    const result = aggregatePanelReview([healthy("OK"), trademarkDrift]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vetoFindings.map((f) => f.id).sort()).toEqual(["V-M", "V-S"]);
    expect([...new Set(result.vetoFindings.map((f) => f.label))]).toEqual(["M"]);
    const rows = Object.fromEntries(result.reviewRows.map((r) => [r.label, r]));
    expect(rows["OK"].panelVerdict).toBe("pass");
  });

  // 既定 count=1 で1枚ずつ提出しても、採用済みとの不揃いを判定できること。
  it("採用済み画像と揃っとらん1枚提出を V-S で落とす", () => {
    const accepted = [
      { ...healthy("A1"), label: "A1" },
      { ...healthy("A2"), label: "A2" },
    ];
    const drifting: PanelImageResult = {
      ...healthy("N"),
      trademarkComparison: {
        reference: { structureClass: "ハードスプリット", ratio: "50/50" },
        candidate: { structureClass: "黒筋", ratio: "ほぼ銀" },
      },
    };
    const result = aggregatePanelReview([drifting], { acceptedHistory: accepted });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vetoFindings.map((f) => f.id)).toContain("V-S");
    expect(result.reviewRows[0].panelVerdict).toBe("fail");
  });

  it("採用済みと揃っとる1枚提出は通す", () => {
    const result = aggregatePanelReview([healthy("N")], {
      acceptedHistory: [healthy("A1"), healthy("A2")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vetoFindings).toEqual([]);
    expect(result.reviewRows[0].panelVerdict).toBe("pass");
  });

  // ノーマル画像で sexual_expression=0 を入れても、テーマどおりなら落とさん。
  it("ノーマル画像は sexual_expression を除外して合否を出す", () => {
    const normal: PanelImageResult = {
      ...healthy("NM"),
      intent: "normal",
      scores: scores(7, 7, 7, 7, 0, 7),
    };
    const erotic: PanelImageResult = { ...normal, label: "ER", intent: "erotic" };
    const normalResult = aggregatePanelReview([normal]);
    const eroticResult = aggregatePanelReview([erotic]);
    expect(normalResult.ok && normalResult.reviewRows[0].panelVerdict).toBe("pass");
    expect(eroticResult.ok && eroticResult.reviewRows[0].panelVerdict).toBe("fail");
  });

  it("VETO された候補は総合がキャップされ不合格になる", () => {
    const vetoed: PanelImageResult = {
      ...healthy("V"),
      scores: scores(10, 10, 10, 10, 10, 10),
      touchComparison: {
        reference: CANON_TOUCH,
        candidate: { ...CANON_TOUCH, lineArt: "sketchy" },
      },
    };
    const result = aggregatePanelReview([vetoed]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reviewRows[0].total).toBeLessThanOrEqual(2);
    expect(result.reviewRows[0].panelVerdict).toBe("fail");
  });

  it("intent と touchComparison を集約境界で必須にする", () => {
    const missingIntent = { ...healthy("I"), intent: undefined };
    const missingTouch = { ...healthy("T"), touchComparison: undefined };
    const result = aggregatePanelReview([missingIntent, missingTouch]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("intent");
    expect(result.rejections.join()).toContain("touchComparison");
  });

  it("混在バッチでもコピーされた1枚だけを名指しして拒否する", () => {
    const copiedEvidence = {
      ...healthy("COPIED"),
      lensEvidence: {
        ...evidence("COPIED"),
        identity_body: "同じ根拠",
        touch: "同じ根拠",
      },
    };
    const result = aggregatePanelReview([copiedEvidence, healthy("HONEST")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("COPIED");
    expect(result.rejections.join()).toContain("複製");
  });

  it("比率だけの許容差は V-M にせず、構造型の差だけを V-M にする", () => {
    const ratioDrift = {
      ...healthy("R"),
      trademarkComparison: {
        reference: { structureClass: "ハードスプリット", ratio: "50/50" },
        candidate: { structureClass: "ハードスプリット", ratio: "70/30" },
      },
    };
    const result = aggregatePanelReview([ratioDrift]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vetoFindings.map((finding) => finding.id)).not.toContain("V-M");
  });

  it("V-A と V-I を構造化レンズ所見から導出する", () => {
    const fatal = {
      ...healthy("F"),
      fatalAnatomyDefects: ["腕が3本"],
      fatalIdentityDiscontinuities: ["顔が別人"],
    };
    const result = aggregatePanelReview([fatal]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vetoFindings.map((finding) => finding.id).sort()).toEqual(["V-A", "V-I"]);
    expect(result.reviewRows[0].panelVerdict).toBe("fail");
    expect(result.criterionRows.find((row) => row.criterionKey === "anatomy_physics")?.isVeto).toBe(
      1,
    );
    expect(result.criterionRows.find((row) => row.criterionKey === "identity_body")?.isVeto).toBe(
      1,
    );
    expect(result.criterionRows.find((row) => row.criterionKey === "touch")?.isVeto).toBe(0);
  });

  it("criterion 行へ各レンズの根拠を保存する", () => {
    const result = aggregatePanelReview([healthy("E")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.criterionRows.every((row) => row.comment.includes(row.criterionKey))).toBe(true);
  });

  // 2026-07-26 に本番へ残った形そのもの（image_review_criterion 10レビュー分）を
  // 実物の集約器へ入れる。テスト内で加重和を組み直すと、集約器を差し替えても赤にならん。
  it("本番で起きたコピー形を実物の集約器が拒否する（SQLを1行も作らせん）", () => {
    const productionCopied = [
      ["HA", 8, 9, 9, 9],
      ["IB", 9, 8, 8, 9],
      ["IC", 7, 6, 8, 7],
      ["ID", 8, 9, 8, 8],
    ].map(([label, identity, anatomy, situation, sexual]) => ({
      ...healthy(label as string),
      // 割り戻しで identity が touch / personality へコピーされとった
      scores: scores(
        identity as number,
        identity as number,
        anatomy as number,
        situation as number,
        sexual as number,
        identity as number,
      ),
    }));
    const result = aggregatePanelReview(productionCopied);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("touch が identity_body の複製");
    expect(result.rejections.join()).toContain("personality が identity_body の複製");
  });

  // 省略は「未確認」。空配列（確認して該当なし）とは別物として扱う。
  it("fatalAnatomyDefects / fatalIdentityDiscontinuities の省略を差し戻す", () => {
    const noAnatomy = { ...healthy("A"), fatalAnatomyDefects: undefined };
    const noIdentity = { ...healthy("I"), fatalIdentityDiscontinuities: undefined };
    const result = aggregatePanelReview([noAnatomy, noIdentity]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("fatalAnatomyDefects が無い");
    expect(result.rejections.join()).toContain("fatalIdentityDiscontinuities が無い");
  });

  it("trademarkComparison の欠落と空 structureClass を差し戻す", () => {
    const missing = { ...healthy("M"), trademarkComparison: undefined };
    const empty = {
      ...healthy("E"),
      trademarkComparison: {
        reference: { structureClass: "ハードスプリット" },
        candidate: { structureClass: "  " },
      },
    };
    const result = aggregatePanelReview([missing, empty]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("trademarkComparison が無い");
    expect(result.rejections.join()).toContain("candidate.structureClass が空");
  });

  it("ラベル重複を集約境界で差し戻す", () => {
    const result = aggregatePanelReview([healthy("DUP"), healthy("DUP")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.join()).toContain("ラベルが提出内で重複");
  });

  it("数値 0/1 の isVeto は正規化し、それ以外は拒否する", () => {
    const numeric = aggregatePanelReview([{ ...healthy("N"), isVeto: 1 }]);
    expect(numeric.ok && numeric.reviewRows[0].panelVerdict).toBe("fail");
    const invalid = aggregatePanelReview([
      { ...healthy("X"), isVeto: 2 as unknown as PanelImageResult["isVeto"] },
    ]);
    expect(invalid.ok).toBe(false);
  });
});
