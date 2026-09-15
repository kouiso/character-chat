import {
  analyzeAxisCopy,
  computePanelTotal,
  deriveSetDriftFindings,
  deriveVetoFindings,
  findUnverifiableSubmissions,
  normalizeVetoFlag,
  PANEL_CRITERION_KEYS,
  normalizedWeightsForIntent,
  PANEL_PASS_THRESHOLD,
  parsePanelScores,
  type AxisCopyFinding,
  type PanelCriterionKey,
  type PanelImageResult,
  type VetoFinding,
} from "./image-review-panel";

// 集約役が D1 へ書く前に必ず通す関門。ここを経由せんと、
// 「4軸で採って6キーへ割り戻す」も「VETO を立て忘れる」も従来どおり通ってまう。

export type PanelReviewRow = {
  label: string;
  aiPanelJson: string;
  isVeto: number;
  total: number;
  verdict: "pending";
  panelVerdict: "pass" | "fail";
};

export type PanelCriterionRow = {
  label: string;
  criterionKey: PanelCriterionKey;
  weight: number;
  panelScore: number;
  isVeto: number;
  comment: string;
};

export type AggregateRejection = {
  ok: false;
  rejections: string[];
};

export type AggregateAcceptance = {
  ok: true;
  reviewRows: PanelReviewRow[];
  criterionRows: PanelCriterionRow[];
  vetoFindings: VetoFinding[];
};

export type AggregateResult = AggregateAcceptance | AggregateRejection;

const describeAxisCopy = (finding: AxisCopyFinding): string =>
  `${finding.label ? `${finding.label}: ` : ""}${finding.key} が ${finding.copiedFrom} の複製（根拠: ${finding.evidence}）。軸ごとに独立採点し直す`;

// 空配列＝「確認して該当なし」、省略＝未確認（prompt/agents/reviewer-panel.md）。
// 未確認を通すと V-A / V-I を一度も判定せんまま合格行が D1 へ残る。
const requireExplicitFatalList = (
  label: string,
  field: "fatalAnatomyDefects" | "fatalIdentityDiscontinuities",
  value: readonly string[] | undefined,
): string[] => {
  if (value === undefined) {
    return [`${label}: ${field} が無い。該当なしなら空配列を明示する（省略は未確認）`];
  }
  if (!Array.isArray(value)) return [`${label}: ${field} が配列やない`];
  return value.some((entry) => typeof entry !== "string")
    ? [`${label}: ${field} に文字列やない要素がある`]
    : [];
};

// トレードマーク突合が無い提出は V-M を一度も判定せんまま通る。
// 構造型が変わった候補（ダウナーの白黒50/50スプリット → ほぼ銀）が素通りした形。
const requireTrademarkComparison = (result: PanelImageResult): string[] => {
  const comparison = result.trademarkComparison;
  if (!comparison) {
    return [`${result.label}: trademarkComparison が無い。V-M を判定でけへん`];
  }
  return (["reference", "candidate"] as const).flatMap((side) => {
    const structureClass = comparison[side]?.structureClass;
    return typeof structureClass === "string" && structureClass.trim().length > 0
      ? []
      : [`${result.label}: trademarkComparison.${side}.structureClass が空`];
  });
};

// ラベルは reviewRows / criterionRows の突合キーとして使う。重複すると
// 片方の画像のメタデータが両方の親行へ書かれ、criterion 行も両方へ二重に付く。
const findDuplicateLabels = (rawResults: readonly PanelImageResult[]): string[] => {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const result of rawResults) {
    if (seen.has(result.label)) duplicated.add(result.label);
    seen.add(result.label);
  }
  return [...duplicated].map((label) => `${label}: ラベルが提出内で重複しとる`);
};

const TOUCH_KEYS = ["specular", "shading", "lineArt", "saturation", "colourTemperature"] as const;

const requireTouchComparison = (result: PanelImageResult): string[] => {
  const comparison = result.touchComparison;
  if (!comparison) return [`${result.label}: touchComparison の5項目が無い`];
  const missing = TOUCH_KEYS.filter(
    (key) => !comparison.reference[key]?.trim() || !comparison.candidate[key]?.trim(),
  );
  return missing.length > 0
    ? [`${result.label}: touchComparison が不完全 (${missing.join(", ")})`]
    : [];
};

const requireVetoFlag = (result: PanelImageResult): string[] => {
  try {
    normalizeVetoFlag(result.isVeto);
    return [];
  } catch (error) {
    return [`${result.label}: ${(error as Error).message}`];
  }
};

const rejectionsForResult = (result: PanelImageResult): string[] => {
  const parsed = parsePanelScores(result.scores);
  return [
    ...(parsed.ok ? [] : [`${result.label}: ${parsed.problems.join(" / ")}`]),
    ...(result.intent === "normal" || result.intent === "erotic"
      ? []
      : [`${result.label}: intent は normal / erotic のどちらかを必ず指定する`]),
    ...requireVetoFlag(result),
    ...requireTouchComparison(result),
    ...requireTrademarkComparison(result),
    ...requireExplicitFatalList(result.label, "fatalAnatomyDefects", result.fatalAnatomyDefects),
    ...requireExplicitFatalList(
      result.label,
      "fatalIdentityDiscontinuities",
      result.fatalIdentityDiscontinuities,
    ),
  ];
};

const collectRejections = (rawResults: readonly PanelImageResult[]): string[] => {
  const rejections: string[] = [
    ...findDuplicateLabels(rawResults),
    ...rawResults.flatMap(rejectionsForResult),
  ];
  for (const entry of findUnverifiableSubmissions(rawResults)) {
    rejections.push(
      `${entry.label}: レンズの根拠が無い(${entry.missing.join(", ")})。複製かどうか判定でけへん`,
    );
  }
  const axisCopy = analyzeAxisCopy(rawResults);
  // 未判定を「複製なし」として通さん。判定材料が足りん提出は差し戻す。
  if (!axisCopy.decidable) {
    rejections.push(`軸コピーを判定でけへん: ${axisCopy.undecidableReason ?? "判定材料が不足"}`);
  }
  for (const finding of axisCopy.findings) {
    rejections.push(describeAxisCopy(finding));
  }
  return rejections;
};

const buildReviewRow = (
  result: PanelImageResult,
  resultVetoFindings: VetoFinding[],
  isVeto: boolean,
): PanelReviewRow => {
  const intent = result.intent as "normal" | "erotic";
  const weights = normalizedWeightsForIntent(intent);
  const total = computePanelTotal(result.scores, isVeto, intent);
  const panelVerdict = !isVeto && total >= PANEL_PASS_THRESHOLD ? "pass" : "fail";
  const criteria = Object.fromEntries(
    PANEL_CRITERION_KEYS.map((key) => [key, { score: result.scores[key], weight: weights[key] }]),
  );
  return {
    label: result.label,
    aiPanelJson: JSON.stringify({
      criteria,
      veto: resultVetoFindings,
      intent,
      lensEvidence: result.lensEvidence,
      touchComparison: result.touchComparison,
      trademarkComparison: result.trademarkComparison,
      fatalAnatomyDefects: result.fatalAnatomyDefects || [],
      fatalIdentityDiscontinuities: result.fatalIdentityDiscontinuities || [],
      panelVerdict,
      total,
    }),
    isVeto: isVeto ? 1 : 0,
    total,
    verdict: "pending",
    panelVerdict,
  };
};

const buildCriterionRows = (
  result: PanelImageResult,
  resultVetoFindings: VetoFinding[],
): PanelCriterionRow[] => {
  const weights = normalizedWeightsForIntent(result.intent as "normal" | "erotic");
  return PANEL_CRITERION_KEYS.map((key) => ({
    label: result.label,
    criterionKey: key,
    weight: weights[key],
    panelScore: result.scores[key],
    isVeto: resultVetoFindings.some((finding) => finding.criterionKey === key) ? 1 : 0,
    comment: result.lensEvidence?.[key] || "",
  }));
};

const buildRows = (
  rawResults: readonly PanelImageResult[],
  vetoFindings: VetoFinding[],
): { reviewRows: PanelReviewRow[]; criterionRows: PanelCriterionRow[] } => {
  const reviewRows: PanelReviewRow[] = [];
  const criterionRows: PanelCriterionRow[] = [];
  for (const result of rawResults) {
    const resultVetoFindings = vetoFindings.filter((finding) => finding.label === result.label);
    const isVeto = resultVetoFindings.length > 0 || normalizeVetoFlag(result.isVeto);
    reviewRows.push(buildReviewRow(result, resultVetoFindings, isVeto));
    criterionRows.push(...buildCriterionRows(result, resultVetoFindings));
  }
  return { reviewRows, criterionRows };
};

export const aggregatePanelReview = (
  rawResults: readonly PanelImageResult[],
  // 既に採用済みの画像。1枚ずつ提出する既定経路でもセット整合を判定できるようにする。
  options: { acceptedHistory?: readonly PanelImageResult[] } = {},
): AggregateResult => {
  if (rawResults.length === 0) return { ok: false, rejections: ["提出が空"] };

  const rejections = collectRejections(rawResults);
  if (rejections.length > 0) return { ok: false, rejections };

  const vetoFindings = [
    ...deriveVetoFindings(rawResults),
    ...deriveSetDriftFindings(rawResults, options.acceptedHistory ?? []),
  ];
  return { ok: true, ...buildRows(rawResults, vetoFindings), vetoFindings };
};
