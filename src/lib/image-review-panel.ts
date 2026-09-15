// 画像審査パネルの集約規則。プロンプト(prompt/agents/reviewer-panel.md)だけに書くと、
// 2026-07-26 に本番で起きた「4軸JSONを6キーへ割り戻す時に identity を touch と personality へ
// コピーする」が同じ形で再発する — 実際その時も設計上は独立軸のつもりやった。
// 加重和と軸コピー検出はコードに置いて機械で止める。

export const PANEL_CRITERION_KEYS = [
  "identity_body",
  "touch",
  "anatomy_physics",
  "expected_situation",
  "sexual_expression",
  "personality",
] as const;

export type PanelCriterionKey = (typeof PANEL_CRITERION_KEYS)[number];

export const PANEL_CRITERION_WEIGHTS: Record<PanelCriterionKey, number> = {
  identity_body: 0.25,
  touch: 0.2,
  anatomy_physics: 0.15,
  expected_situation: 0.15,
  sexual_expression: 0.15,
  personality: 0.1,
};

export const PANEL_PASS_THRESHOLD = 6;
// VETO 発火時は加重和に関係なく総合をここまで落とす。
export const PANEL_VETO_CAP = 2;
export const PANEL_SCORE_MIN = 0;
export const PANEL_SCORE_MAX = 10;

export type PanelScores = Record<PanelCriterionKey, number>;

// タッチレンズが正典と候補について1つずつ言語化する5項目。
// 描画モデル由来(shading / lineArt)と、照明で正当に動く項目(saturation / colourTemperature)と、
// その中間(specular)に分かれる。V-T の発火条件をこの区別に載せる。
export type TouchClasses = {
  specular: string;
  shading: string;
  lineArt: string;
  saturation: string;
  colourTemperature: string;
};

export type TrademarkDescriptor = {
  structureClass: string;
  ratio?: string;
  details?: string;
};

const RENDERING_MODEL_TOUCH_KEYS = ["shading", "lineArt"] as const;
const LIGHTING_DEPENDENT_TOUCH_KEYS = ["saturation", "colourTemperature", "specular"] as const;

export type PanelImageResult = {
  label: string;
  scores: PanelScores;
  isVeto?: boolean | 0 | 1;
  // ノーマル画像は sexual_expression を採点対象から外す（測る対象が無いため）。
  intent?: "normal" | "erotic";
  // 各レンズが自分で書いた根拠。同一文字列が2軸に入っとったら、それは独立採点やのうて複製。
  lensEvidence?: Partial<Record<PanelCriterionKey, string>>;
  // 正典と候補のタッチ5項目。VETO を点数やのうて記述から導くために使う。
  touchComparison?: { reference: TouchClasses; candidate: TouchClasses };
  // トレードマークの構造型（例「50/50ハードスプリット」）。比率のブレは許容、型の変化は V-M。
  trademarkComparison?: {
    reference: TrademarkDescriptor;
    candidate: TrademarkDescriptor;
  };
  fatalAnatomyDefects?: readonly string[];
  fatalIdentityDiscontinuities?: readonly string[];
};

// 0.01 単位へ丸める。`Math.round(x * 100) / 100` は 1.005 が二進で 1.0049999999999997 に
// なるため 1.00 へ落ちる。一度 toFixed で十進表現へ寄せてから丸める。
const roundToCent = (value: number): number => Math.round(Number((value * 100).toFixed(6))) / 100;

// 採点は 0-10 スケール。範囲外の値をそのまま加重和へ入れると総合が 10 を超えたり
// 負になったりして、合格ラインや VETO キャップの意味が崩れる。入口で挟む。
const clampScore = (score: number): number =>
  Math.min(PANEL_SCORE_MAX, Math.max(PANEL_SCORE_MIN, score));

export const findOutOfRangeScores = (scores: PanelScores): PanelCriterionKey[] =>
  PANEL_CRITERION_KEYS.filter(
    (key) =>
      !Number.isFinite(scores[key]) ||
      scores[key] < PANEL_SCORE_MIN ||
      scores[key] > PANEL_SCORE_MAX,
  );

// 6レンズの出力や保存済みJSONは型注釈では守れん。欠損キー・非数値が1つ混じると
// 加重和が NaN になり、VETO を立てても NaN のまま D1 へ書かれる。境界で弾く。
export type PanelScoresValidation =
  | { ok: true; scores: PanelScores }
  | { ok: false; problems: string[] };

const describeScoreProblem = (key: PanelCriterionKey, value: unknown): string | null => {
  if (value === undefined || value === null) return `${key} が無い`;
  if (typeof value !== "number" || !Number.isFinite(value)) return `${key} が有限の数値やない`;
  if (value < PANEL_SCORE_MIN || value > PANEL_SCORE_MAX) {
    return `${key} が ${PANEL_SCORE_MIN}-${PANEL_SCORE_MAX} の外`;
  }
  return null;
};

export const parsePanelScores = (raw: unknown): PanelScoresValidation => {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, problems: ["scores はオブジェクトやない"] };
  }
  const record = raw as Record<string, unknown>;
  const problems: string[] = [];
  const parsed = {} as PanelScores;
  for (const key of PANEL_CRITERION_KEYS) {
    const problem = describeScoreProblem(key, record[key]);
    if (problem) problems.push(problem);
    else parsed[key] = record[key] as number;
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, scores: parsed };
};

// ノーマル画像（非性的なテーマ）では sexual_expression は測る対象が無い。
// 0.15 の重みのまま 0 を入れると、他5軸が7点でも総合 5.95 で不合格になる。
// 対象外の軸は除外して残りの重みを正規化する。
export type PanelImageIntent = "normal" | "erotic";

export const criterionKeysForIntent = (intent: PanelImageIntent): PanelCriterionKey[] =>
  intent === "normal"
    ? PANEL_CRITERION_KEYS.filter((key) => key !== "sexual_expression")
    : [...PANEL_CRITERION_KEYS];

export const normalizedWeightsForIntent = (
  intent: PanelImageIntent,
): Record<PanelCriterionKey, number> => {
  const keys = criterionKeysForIntent(intent);
  const sum = keys.reduce((total, key) => total + PANEL_CRITERION_WEIGHTS[key], 0);
  return Object.fromEntries(
    PANEL_CRITERION_KEYS.map((key) => [
      key,
      keys.includes(key) ? PANEL_CRITERION_WEIGHTS[key] / sum : 0,
    ]),
  ) as Record<PanelCriterionKey, number>;
};

export class PanelScoresError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`パネル採点が不正: ${problems.join(" / ")}`);
    this.name = "PanelScoresError";
    this.problems = problems;
  }
}

// 不正な採点はクランプで飲み込まず投げる。クランプすると、欠損で NaN になった行や
// レンジ外の値が「たまたま合格した審査」として D1 へ残る。
export const computePanelTotal = (
  scores: PanelScores,
  isVeto = false,
  intent: PanelImageIntent = "erotic",
): number => {
  const parsed = parsePanelScores(scores);
  if (!parsed.ok) throw new PanelScoresError(parsed.problems);
  const weights = normalizedWeightsForIntent(intent);
  const weighted = PANEL_CRITERION_KEYS.reduce(
    (total, key) => total + weights[key] * clampScore(parsed.scores[key]),
    0,
  );
  const rounded = roundToCent(weighted);
  const capped = isVeto ? Math.min(PANEL_VETO_CAP, rounded) : rounded;
  // 重みの総和が 1.0 でなくなる改変（キーの追加・正規化の削除）を入れられても、
  // 総合が 0-10 の外へ出ることだけは無いようにする。合格ラインと VETO キャップは
  // このレンジ内の値であることを前提にしとる。
  return clampScore(capped);
};

// identity から複製された疑いのある軸。
const COPY_SUSPECT_KEYS: PanelCriterionKey[] = ["touch", "personality"];
// 割り戻しや平均化を経ると 0.1+0.2 が 0.3 と厳密一致せんため、コピーを取り逃す。
const SCORE_EQUAL_TOLERANCE = 1e-9;
const scoresEqual = (a: number, b: number): boolean => Math.abs(a - b) <= SCORE_EQUAL_TOLERANCE;

// 単一軸だけのコピーは偶然の同点と見分けが付かん。これだけの枚数が全部一致したら
// 偶然では説明でけへん、という下限。
const SINGLE_AXIS_COPY_MIN_IMAGES = 4;

export type AxisCopyFinding = {
  label?: string;
  key: PanelCriterionKey;
  copiedFrom: PanelCriterionKey;
  // provenance = レンズの根拠テキストが同一（同点やのうて出所が同じ。枚数を問わず確定）
  // both = 疑わしい2軸が揃って identity と一致（本番で起きた形。複数枚でのみ）
  // single = 1軸のみだが、偶然では説明でけへん枚数で一致
  evidence: "provenance" | "both" | "single";
};

const normalizeEvidence = (text: string | undefined): string =>
  (text ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// 同点やのうて「出所が同じ」ことを示す証拠。独立レンズが偶然まったく同じ文面を書くことは無い。
const copiesIdentityEverywhere = (
  results: readonly PanelImageResult[],
  key: PanelCriterionKey,
): boolean => results.every((r) => scoresEqual(r.scores[key], r.scores.identity_body));

// 提出セット内で touch / personality が identity_body の複製になっとらんかを見る。
//
// 同点は複製の証拠として弱い。独立に走らせたレンズが同じ整数を選ぶのは普通に起きるし、
// 1枚だけの提出（この repo の既定 count=1）では区別が付かん。そこで根拠を3段に分けた。
//  - provenance: レンズの根拠テキストが identity と同一 → 枚数を問わず確定。
//    1枚提出でも効くのはこれだけ。だから根拠テキストの添付を必須にする
//    （`findUnverifiableSubmissions` が欠落を検出して差し戻す）。
//  - both: 疑わしい2軸が揃って同点 → 2枚以上でのみ違反。
//  - single: 1軸だけ同点 → 偶然が説明でけへん4枚以上でのみ違反。
// 同点だけでは1枚提出の複製を判定でけへん。判定を諦めるのやのうて、判定に要る材料
// （各レンズが自分で書いた根拠）が欠けとることを検出して差し戻す。
// これが無いと count=1 の既定経路で複製が素通りする。
export const findUnverifiableSubmissions = (
  results: readonly PanelImageResult[],
): Array<{ label: string; missing: PanelCriterionKey[] }> =>
  results
    .map((result) => ({
      label: result.label,
      missing: PANEL_CRITERION_KEYS.filter((key) => !normalizeEvidence(result.lensEvidence?.[key])),
    }))
    .filter((entry) => entry.missing.length > 0);

// 「複製が無かった」と「複製の有無を判定でけへんかった」を呼び出し側で区別させる。
// 素の配列を返すと、1枚提出で根拠テキストが欠けた未判定が空配列＝合格として素通りする。
export type AxisCopyAnalysis = {
  findings: AxisCopyFinding[];
  // false = 判定材料が足りず、複製の有無を確定でけへん。集約側はこの提出を差し戻す。
  decidable: boolean;
  undecidableReason?: string;
};

export const analyzeAxisCopy = (results: readonly PanelImageResult[]): AxisCopyAnalysis => {
  if (results.length === 0) {
    return { findings: [], decidable: false, undecidableReason: "提出が空" };
  }

  const provenanceCopied = results.flatMap((result) =>
    COPY_SUSPECT_KEYS.filter((key) => {
      const evidence = normalizeEvidence(result.lensEvidence?.[key]);
      const identityEvidence = normalizeEvidence(result.lensEvidence?.identity_body);
      return evidence.length > 0 && evidence === identityEvidence;
    }).map((key) => ({
      label: result.label,
      key,
      copiedFrom: "identity_body" as const,
      evidence: "provenance" as const,
    })),
  );
  if (provenanceCopied.length > 0) {
    return { findings: provenanceCopied, decidable: true };
  }

  // 同点だけを根拠にするので、1枚提出では判定でけへん。ここを空配列で返すと
  // 「複製なし」と見分けが付かんくなるため、未判定として明示する。
  if (results.length < 2) {
    const missingEvidence = findUnverifiableSubmissions(results);
    if (missingEvidence.length > 0) {
      return {
        findings: [],
        decidable: false,
        undecidableReason:
          "1枚提出は同点だけでは複製を判定でけへん。根拠テキスト(lensEvidence)が要る",
      };
    }
    // 根拠テキストが6軸そろっとって、identity と一致する軸が無い＝独立採点として確定。
    return { findings: [], decidable: true };
  }

  const copiedKeys = COPY_SUSPECT_KEYS.filter((key) => copiesIdentityEverywhere(results, key));

  if (copiedKeys.length === COPY_SUSPECT_KEYS.length) {
    return {
      decidable: true,
      findings: copiedKeys.map((key) => ({
        key,
        copiedFrom: "identity_body" as const,
        evidence: "both" as const,
      })),
    };
  }

  if (results.length >= SINGLE_AXIS_COPY_MIN_IMAGES) {
    return {
      decidable: true,
      findings: copiedKeys.map((key) => ({
        key,
        copiedFrom: "identity_body" as const,
        evidence: "single" as const,
      })),
    };
  }
  return { findings: [], decidable: true };
};

export const detectAxisCopy = (results: readonly PanelImageResult[]): AxisCopyFinding[] =>
  analyzeAxisCopy(results).findings;

export type VetoFinding = {
  label: string;
  id: "V-T" | "V-M" | "V-S" | "V-A" | "V-I";
  criterionKey: PanelCriterionKey;
  reason: string;
};

const changedTouchKeys = (comparison: {
  reference: TouchClasses;
  candidate: TouchClasses;
}): string[] =>
  (Object.keys(comparison.reference) as Array<keyof TouchClasses>).filter(
    (key) =>
      normalizeEvidence(comparison.reference[key]) !== normalizeEvidence(comparison.candidate[key]),
  );

// V-T は「描画モデルが変わった」証拠に限る。彩度・色温度・スペキュラは、同じ画風のままでも
// 照明を変えれば正当に動く（涼しいプロフ写真 vs 暖色の寝室）。そこ単独で veto すると
// 意図したテーマ違いの候補まで落ちる。描画モデル由来(shading / lineArt)の変化か、
// 照明由来が2つ以上同時に動いた時だけ発火させる。
// V-M / V-S は各候補を「正典」と突き合わせて、外れた候補だけを veto する。
// セット内で値が割れたこと自体は veto の理由にせん（許容内のブレで全滅させんため）。
const touchVetoFinding = (result: PanelImageResult): VetoFinding | null => {
  if (!result.touchComparison) return null;
  const changed = changedTouchKeys(result.touchComparison);
  const renderingChanged = changed.filter((key) =>
    (RENDERING_MODEL_TOUCH_KEYS as readonly string[]).includes(key),
  );
  if (renderingChanged.length > 0) {
    return {
      label: result.label,
      id: "V-T",
      criterionKey: "touch",
      reason: `描画モデルが変化: ${renderingChanged.join(", ")}`,
    };
  }
  const lightingChanged = changed.filter((key) =>
    (LIGHTING_DEPENDENT_TOUCH_KEYS as readonly string[]).includes(key),
  );
  if (lightingChanged.length >= 2) {
    return {
      label: result.label,
      id: "V-T",
      criterionKey: "touch",
      reason: `照明由来の項目が同時に複数変化: ${lightingChanged.join(", ")}`,
    };
  }
  return null;
};

const trademarkVetoFinding = (result: PanelImageResult): VetoFinding | null => {
  const comparison = result.trademarkComparison;
  if (!comparison) return null;
  if (
    normalizeEvidence(comparison.reference.structureClass) ===
    normalizeEvidence(comparison.candidate.structureClass)
  ) {
    return null;
  }
  return {
    label: result.label,
    id: "V-M",
    criterionKey: "identity_body",
    reason: `トレードマークの構造型が正典と違う: ${comparison.candidate.structureClass}`,
  };
};

export const deriveVetoFindings = (results: readonly PanelImageResult[]): VetoFinding[] =>
  results.flatMap((result) => {
    const findings = [touchVetoFinding(result), trademarkVetoFinding(result)].filter(
      (finding): finding is VetoFinding => finding !== null,
    );
    if ((result.fatalAnatomyDefects?.length ?? 0) > 0) {
      findings.push({
        label: result.label,
        id: "V-A",
        criterionKey: "anatomy_physics",
        reason: `致命的な人体破綻: ${result.fatalAnatomyDefects?.join(", ")}`,
      });
    }
    if ((result.fatalIdentityDiscontinuities?.length ?? 0) > 0) {
      findings.push({
        label: result.label,
        id: "V-I",
        criterionKey: "identity_body",
        reason: `別人化: ${result.fatalIdentityDiscontinuities?.join(", ")}`,
      });
    }
    return findings;
  });

const modalValue = (values: string[]): string | null => {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

const setDescriptors = (result: PanelImageResult): { touch: string; trademark: string } => ({
  touch: result.touchComparison
    ? RENDERING_MODEL_TOUCH_KEYS.map((key) =>
        normalizeEvidence(result.touchComparison?.candidate[key]),
      ).join("|")
    : "",
  trademark: normalizeEvidence(result.trademarkComparison?.candidate.structureClass),
});

const setDriftForField = (
  candidates: readonly PanelImageResult[],
  all: readonly PanelImageResult[],
  field: "touch" | "trademark",
): VetoFinding[] => {
  const values = all.map((result) => setDescriptors(result)[field]).filter(Boolean);
  if (values.length < 2) return [];
  const mode = modalValue(values);
  if (mode === null) return [];
  return candidates.flatMap((candidate) => {
    const value = setDescriptors(candidate)[field];
    if (!value || value === mode) return [];
    return [
      {
        label: candidate.label,
        id: "V-S" as const,
        criterionKey: field === "touch" ? ("touch" as const) : ("identity_body" as const),
        reason: `採用済みの画像と${field === "touch" ? "タッチ" : "トレードマーク"}が揃っとらん: ${value}`,
      },
    ];
  });
};

// V-S — 既に採用済みの画像とも突き合わせる。
// `/add-char-photo` の既定は count=1 なので、1回ごとの提出だけ見とったらセット整合を
// 一度も判定せんまま、個別には許容内のブレが積み上がってギャラリーが不揃いになる。
// 候補は正典だけでなく「これまで採用した画像」とも比べる。
export const deriveSetDriftFindings = (
  candidates: readonly PanelImageResult[],
  acceptedHistory: readonly PanelImageResult[] = [],
): VetoFinding[] => {
  const all = [...acceptedHistory, ...candidates];
  if (all.length < 2) return [];
  return (["touch", "trademark"] as const).flatMap((field) =>
    setDriftForField(candidates, all, field),
  );
};

export const normalizeVetoFlag = (value: unknown): boolean => {
  if (value === undefined || value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  throw new TypeError("isVeto must be a boolean or 0/1");
};

// VETO は「加重和に関係なく落とす」宣言なので、順位付けでも必ず非VETOより下に来る必要がある。
export const comparePanelResults = (a: PanelImageResult, b: PanelImageResult): number => {
  const aVeto = normalizeVetoFlag(a.isVeto) || deriveVetoFindings([a]).length > 0;
  const bVeto = normalizeVetoFlag(b.isVeto) || deriveVetoFindings([b]).length > 0;
  if (aVeto !== bVeto) return aVeto ? 1 : -1;
  return (
    computePanelTotal(b.scores, bVeto, b.intent ?? "erotic") -
    computePanelTotal(a.scores, aVeto, a.intent ?? "erotic")
  );
};

export const isPanelPassing = (result: PanelImageResult): boolean =>
  !normalizeVetoFlag(result.isVeto) &&
  deriveVetoFindings([result]).length === 0 &&
  computePanelTotal(result.scores, false, result.intent ?? "erotic") >= PANEL_PASS_THRESHOLD;

// 軸コピーが起きた時に加重和が畳まれる先の重み。identity が実効で過半を握る。
export const collapsedIdentityWeight = (): number =>
  PANEL_CRITERION_WEIGHTS.identity_body +
  PANEL_CRITERION_WEIGHTS.touch +
  PANEL_CRITERION_WEIGHTS.personality;
