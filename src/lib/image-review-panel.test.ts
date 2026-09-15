import { describe, expect, it } from "vitest";

import {
  analyzeAxisCopy,
  collapsedIdentityWeight,
  comparePanelResults,
  computePanelTotal,
  deriveVetoFindings,
  detectAxisCopy,
  findOutOfRangeScores,
  findUnverifiableSubmissions,
  isPanelPassing,
  normalizedWeightsForIntent,
  PanelScoresError,
  parsePanelScores,
  deriveSetDriftFindings,
  PANEL_CRITERION_KEYS,
  PANEL_CRITERION_WEIGHTS,
  PANEL_PASS_THRESHOLD,
  PANEL_SCORE_MAX,
  PANEL_SCORE_MIN,
  PANEL_VETO_CAP,
  type PanelImageResult,
  type PanelScores,
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

const uniform = (value: number): PanelScores => scores(value, value, value, value, value, value);

// 本番 image_review_criterion(10レビュー)の実測値。4軸JSONから6キーへ割り戻す時に
// identity を touch / personality へコピーしていたため、この形になっていた。
const copied = (
  label: string,
  identity: number,
  anatomy: number,
  situation: number,
  sexual: number,
): PanelImageResult => ({
  label,
  scores: scores(identity, identity, anatomy, situation, sexual, identity),
});

const PRODUCTION_COPIED_SET = [
  copied("HA", 8, 9, 9, 9),
  copied("IB", 9, 8, 8, 9),
  copied("IC", 7, 6, 8, 7),
  copied("ID", 8, 9, 8, 8),
];

describe("パネル定数", () => {
  // 重みそのものを固定する。合計1.0 だけを見るテストでは
  // identity=.35 / touch=.10 / personality=.10 のような「identity 偏重へ戻す」改変が素通りする。
  it("6キーの重みは仕様値そのもの", () => {
    expect(PANEL_CRITERION_WEIGHTS).toEqual({
      identity_body: 0.25,
      touch: 0.2,
      anatomy_physics: 0.15,
      expected_situation: 0.15,
      sexual_expression: 0.15,
      personality: 0.1,
    });
  });

  it("重みの合計は 1.0", () => {
    const total = PANEL_CRITERION_KEYS.reduce((sum, key) => sum + PANEL_CRITERION_WEIGHTS[key], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("合格ライン・VETOキャップ・採点レンジは仕様値そのもの", () => {
    expect(PANEL_PASS_THRESHOLD).toBe(6);
    expect(PANEL_VETO_CAP).toBe(2);
    expect(PANEL_SCORE_MIN).toBe(0);
    expect(PANEL_SCORE_MAX).toBe(10);
  });

  // 定数の一致だけを見るテストは、定数と一緒に書き換えられたら素通りする。
  // 重み1つを動かしたら「その軸を動かした時の総合の動き幅」が変わることを別途固定する。
  it("各軸の重みは総合への実効影響として現れる", () => {
    const base = uniform(10);
    for (const key of PANEL_CRITERION_KEYS) {
      const dropped = { ...base, [key]: 0 };
      expect(computePanelTotal(base) - computePanelTotal(dropped)).toBeCloseTo(
        10 * PANEL_CRITERION_WEIGHTS[key],
        10,
      );
    }
    // 実効影響の期待値そのものも固定する（重みと一緒に書き換えても、ここで赤になる）。
    expect(computePanelTotal({ ...uniform(10), identity_body: 0 })).toBe(7.5);
    expect(computePanelTotal({ ...uniform(10), touch: 0 })).toBe(8);
    expect(computePanelTotal({ ...uniform(10), anatomy_physics: 0 })).toBe(8.5);
    expect(computePanelTotal({ ...uniform(10), expected_situation: 0 })).toBe(8.5);
    expect(computePanelTotal({ ...uniform(10), sexual_expression: 0 })).toBe(8.5);
    expect(computePanelTotal({ ...uniform(10), personality: 0 })).toBe(9);
  });

  // 合格ラインを動かすと、この境界の合否が入れ替わる。
  it("合格ラインは境界の合否として現れる", () => {
    expect(isPanelPassing({ label: "P", scores: uniform(6) })).toBe(true);
    expect(isPanelPassing({ label: "F", scores: uniform(5.99) })).toBe(false);
    expect(computePanelTotal(uniform(6))).toBe(6);
  });

  // VETO は「加重和に関係なく落とす」宣言。キャップが合格ライン以上へ動いたら宣言が壊れる。
  it("VETOキャップは合格ラインより必ず下", () => {
    expect(PANEL_VETO_CAP).toBeLessThan(PANEL_PASS_THRESHOLD);
  });
});

describe("computePanelTotal", () => {
  // 注意: これは軸コピーが起きた場合の「加重和の算術」だけを固定する。
  // 4軸JSONを6キーへ割り戻す工程自体はこのリポジトリにコード化されていないため、
  // このテストは割り戻しの不具合そのものを検出するものではない。
  it("軸コピー時の記録済み weighted 値を再現する（算術のみを固定）", () => {
    expect(computePanelTotal(PRODUCTION_COPIED_SET[0].scores)).toBe(8.45);
    expect(computePanelTotal(PRODUCTION_COPIED_SET[1].scores)).toBe(8.7);
    expect(computePanelTotal(PRODUCTION_COPIED_SET[2].scores)).toBe(7);
    expect(computePanelTotal(PRODUCTION_COPIED_SET[3].scores)).toBe(8.15);
  });

  it("独立採点された素点から仕様どおりの総合を出す", () => {
    // 0.25*10 + 0.2*0 + 0.15*8 + 0.15*6 + 0.15*4 + 0.1*2 = 5.4
    expect(computePanelTotal(scores(10, 0, 8, 6, 4, 2))).toBe(5.4);
    // 0.25*4 + 0.2*10 + 0.15*0 + 0.15*10 + 0.15*0 + 0.1*10 = 5.5
    expect(computePanelTotal(scores(4, 10, 0, 10, 0, 10))).toBe(5.5);
  });

  it("touch が 10→0 で総合がちょうど 2.0 下がる（重み 0.20 の実効）", () => {
    const base = scores(9, 10, 8, 8, 9, 7);
    const touchFailed = { ...base, touch: 0 };
    expect(computePanelTotal(base) - computePanelTotal(touchFailed)).toBeCloseTo(2, 10);
  });

  it("VETO は加重和に関係なく総合をキャップ値まで落とす", () => {
    expect(computePanelTotal(uniform(10))).toBe(10);
    expect(computePanelTotal(uniform(10), true)).toBe(PANEL_VETO_CAP);
    expect(computePanelTotal(uniform(10), true)).toBeLessThan(PANEL_PASS_THRESHOLD);
  });

  // クランプで飲み込むと、欠損やレンジ外の値が「たまたま合格した審査」として D1 へ残る。
  it("採点レンジ外・欠損・NaN は総合を出さずに投げる", () => {
    expect(() => computePanelTotal(uniform(11))).toThrow(PanelScoresError);
    expect(() => computePanelTotal(uniform(-1))).toThrow(PanelScoresError);
    expect(() => computePanelTotal(uniform(-1), true)).toThrow(PanelScoresError);
    expect(() => computePanelTotal({ identity_body: 8 } as unknown as PanelScores)).toThrow(
      PanelScoresError,
    );
    expect(() => computePanelTotal({ ...uniform(5), touch: Number.NaN })).toThrow(PanelScoresError);
  });

  // ノーマル画像は sexual_expression を測る対象が無い。0.15 のまま 0 を入れると
  // 他5軸が7点でも 5.95 で不合格になり、テーマどおりの画像が落ちる。
  it("ノーマル画像は sexual_expression を除外して重みを正規化する", () => {
    const normalScores = scores(7, 7, 7, 7, 0, 7);
    expect(computePanelTotal(normalScores, false, "erotic")).toBeLessThan(PANEL_PASS_THRESHOLD);
    expect(computePanelTotal(normalScores, false, "normal")).toBe(7);
  });

  it("0.005 の丸めが切り捨て側へ落ちない", () => {
    // 全軸 1.005 → 加重和は数学的に 1.005。二進では 1.0049999999999997 になる。
    expect(computePanelTotal(uniform(1.005))).toBe(1.01);
  });
});

describe("findOutOfRangeScores", () => {
  it("レンジ外の軸を名指しする", () => {
    expect(findOutOfRangeScores(uniform(5))).toEqual([]);
    expect(findOutOfRangeScores(scores(11, 5, 5, 5, 5, -1)).sort()).toEqual([
      "identity_body",
      "personality",
    ]);
    expect(findOutOfRangeScores(scores(Number.NaN, 5, 5, 5, 5, 5))).toEqual(["identity_body"]);
  });
});

describe("comparePanelResults", () => {
  it("VETO 画像は全軸10でも、全軸0の健全画像より下に並ぶ", () => {
    const vetoed: PanelImageResult = { label: "V", scores: uniform(10), isVeto: true };
    const clean: PanelImageResult = { label: "C", scores: uniform(0) };
    expect(computePanelTotal(vetoed.scores, true)).toBeGreaterThan(
      computePanelTotal(clean.scores, false),
    );
    expect([vetoed, clean].sort(comparePanelResults).map((r) => r.label)).toEqual(["C", "V"]);
  });

  it("VETO 同士・非VETO同士は総合の降順", () => {
    const high: PanelImageResult = { label: "H", scores: uniform(9) };
    const low: PanelImageResult = { label: "L", scores: uniform(3) };
    expect([low, high].sort(comparePanelResults).map((r) => r.label)).toEqual(["H", "L"]);
  });

  // VETO の絶対性を1事例やのうて全域で見る。0-10 を 0.5 刻みで振っても、
  // VETO 側が非VETO側を上回る組み合わせが1つも無いこと。
  it("VETO 画像はどの採点でも非VETO画像を上回らん", () => {
    const grid = Array.from({ length: 21 }, (_, i) => i * 0.5);
    for (const vetoScore of grid) {
      const vetoed: PanelImageResult = { label: "V", scores: uniform(vetoScore), isVeto: true };
      const vetoTotal = computePanelTotal(vetoed.scores, true);
      expect(vetoTotal).toBeLessThanOrEqual(PANEL_VETO_CAP);
      expect(isPanelPassing(vetoed)).toBe(false);
      for (const cleanScore of grid) {
        const clean: PanelImageResult = { label: "C", scores: uniform(cleanScore) };
        expect([vetoed, clean].sort(comparePanelResults)[1].label).toBe("V");
      }
    }
  });

  // 総合は 0-10 の外へ出ん。重みの正規化を外す改変を入れても、ここで閉じる。
  it("総合は常に 0-10 に収まる", () => {
    for (const value of [0, 0.5, 3, 6, 9.99, 10]) {
      for (const veto of [false, true]) {
        for (const intent of ["normal", "erotic"] as const) {
          const total = computePanelTotal(uniform(value), veto, intent);
          expect(total).toBeGreaterThanOrEqual(PANEL_SCORE_MIN);
          expect(total).toBeLessThanOrEqual(PANEL_SCORE_MAX);
        }
      }
    }
  });
});

describe("isPanelPassing", () => {
  it("VETO 画像は加重和が合格ラインを超えていても不合格", () => {
    expect(isPanelPassing({ label: "A", scores: uniform(9) })).toBe(true);
    expect(isPanelPassing({ label: "A", scores: uniform(9), isVeto: true })).toBe(false);
  });

  it("合格ラインちょうどは合格", () => {
    expect(isPanelPassing({ label: "B", scores: uniform(6) })).toBe(true);
    expect(isPanelPassing({ label: "B", scores: uniform(5.99) })).toBe(false);
  });
});

describe("detectAxisCopy", () => {
  it("本番で起きた touch/personality のコピーをセット単位で検出する", () => {
    const findings = detectAxisCopy(PRODUCTION_COPIED_SET);
    expect(findings.map((f) => f.key).sort()).toEqual(["personality", "touch"]);
    expect(findings.every((f) => f.evidence === "both")).toBe(true);
  });

  // 1枚提出（add-char-photo の既定 count=1）は同点だけでは判定でけへん。
  // 根拠テキストの一致＝出所が同じ、という証拠でのみ確定させる。
  it("1枚でも根拠テキストが同一ならコピーとして検出する", () => {
    const single: PanelImageResult = {
      label: "S",
      scores: scores(8, 8, 0, 0, 0, 8),
      lensEvidence: {
        identity_body: "プロフと同じ顔立ち",
        touch: "プロフと同じ顔立ち",
        personality: "プロフと同じ顔立ち",
      },
    };
    const findings = detectAxisCopy([single]);
    expect(findings.map((f) => f.key).sort()).toEqual(["personality", "touch"]);
    expect(findings.every((f) => f.evidence === "provenance")).toBe(true);
  });

  // 独立に走らせた identity / touch / personality が同じ整数を選ぶのは普通に起きる。
  // 1枚の同点だけで差し戻すと、正常なレビューを弾いてまう。
  it("1枚の同点だけでは発火しない（根拠が独立なら通す）", () => {
    const single: PanelImageResult = {
      label: "S",
      scores: scores(8, 8, 0, 0, 0, 8),
      lensEvidence: {
        identity_body: "顔の造作は一致",
        touch: "スペキュラの硬さが一致",
        personality: "表情がキャラ通り",
      },
    };
    expect(detectAxisCopy([single])).toEqual([]);
  });

  it("1枚で全軸が同点でも、根拠が独立なら発火しない", () => {
    expect(detectAxisCopy([{ label: "U", scores: uniform(7) }])).toEqual([]);
  });

  it("数値的に等しいが厳密一致しないコピーも検出する", () => {
    // 0.1 + 0.2 は 0.30000000000000004 で 0.3 と === にならない
    const drifted = [1, 2].map((n) => ({
      label: `D${n}`,
      scores: scores(0.3, 0.1 + 0.2, 5, 6, 7, 0.1 + 0.2),
    }));
    expect(
      detectAxisCopy(drifted)
        .map((f) => f.key)
        .sort(),
    ).toEqual(["personality", "touch"]);
  });

  it("整数採点の偶然の同点では発火しない（1軸だけ・少数枚）", () => {
    // touch だけが identity と一致。独立採点でも普通に起きる。
    const honest = [
      { label: "A", scores: scores(8, 8, 9, 7, 6, 5) },
      { label: "B", scores: scores(7, 7, 6, 9, 8, 6) },
    ];
    expect(detectAxisCopy(honest)).toEqual([]);
  });

  it("1軸だけでも4枚全部で一致したらコピーとして扱う", () => {
    const fourTies = [1, 2, 3, 4].map((n) => ({
      label: `T${n}`,
      scores: scores(n + 4, n + 4, 9, 8, 7, n),
    }));
    const findings = detectAxisCopy(fourTies);
    expect(findings.map((f) => f.key)).toEqual(["touch"]);
    expect(findings[0].evidence).toBe("single");
  });

  it("1枚でも独立した値が混じれば発火しない", () => {
    const mixed = [
      ...PRODUCTION_COPIED_SET.slice(0, 3),
      { label: "IE", scores: scores(8, 2, 9, 8, 8, 5) },
    ];
    expect(detectAxisCopy(mixed)).toEqual([]);
  });

  it("空セットは発火しない", () => {
    expect(detectAxisCopy([])).toEqual([]);
  });
});

// 「複製なし」と「判定でけへんかった」を空配列で潰すと、count=1 の既定経路で
// 未判定が合格として素通りする。区別を型で出す。
describe("analyzeAxisCopy", () => {
  it("根拠テキストの無い1枚提出は未判定として返す（空配列で通さん）", () => {
    const analysis = analyzeAxisCopy([{ label: "S", scores: uniform(8) }]);
    expect(analysis.findings).toEqual([]);
    expect(analysis.decidable).toBe(false);
    expect(analysis.undecidableReason).toContain("lensEvidence");
  });

  it("根拠テキストが6軸そろった1枚提出は判定できたものとして返す", () => {
    const lensEvidence = Object.fromEntries(
      PANEL_CRITERION_KEYS.map((key) => [key, `${key} の独立した所見`]),
    );
    const analysis = analyzeAxisCopy([{ label: "S", scores: uniform(8), lensEvidence }]);
    expect(analysis.decidable).toBe(true);
    expect(analysis.findings).toEqual([]);
  });

  it("空提出も未判定として返す", () => {
    expect(analyzeAxisCopy([]).decidable).toBe(false);
  });

  it("複数枚で複製を検出した時は判定済み", () => {
    const analysis = analyzeAxisCopy(PRODUCTION_COPIED_SET);
    expect(analysis.decidable).toBe(true);
    expect(analysis.findings).toHaveLength(2);
  });
});

describe("parsePanelScores", () => {
  it("欠損・非数値・レンジ外を名指しで弾く", () => {
    expect(parsePanelScores({ identity_body: 8 }).ok).toBe(false);
    const missing = parsePanelScores({ identity_body: 8 });
    if (!missing.ok) expect(missing.problems.join()).toContain("touch が無い");

    const nan = parsePanelScores({ ...uniform(5), touch: Number.NaN });
    expect(nan.ok).toBe(false);
    if (!nan.ok) expect(nan.problems.join()).toContain("有限の数値やない");

    const over = parsePanelScores({ ...uniform(5), touch: 11 });
    expect(over.ok).toBe(false);
  });

  it("正しい採点はそのまま通す", () => {
    const parsed = parsePanelScores(uniform(7));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.scores.touch).toBe(7);
  });

  // 欠損キーを黙って通すと NaN が D1 へ残る。投げることで書き込みを止める。
  it("欠損は NaN を返さず例外にする", () => {
    const broken = { identity_body: 8 } as unknown as PanelScores;
    expect(() => computePanelTotal(broken)).toThrow(PanelScoresError);
    expect(() => computePanelTotal(broken, true)).toThrow(PanelScoresError);
  });
});

describe("findUnverifiableSubmissions", () => {
  it("根拠テキストが無い提出を名指しする", () => {
    const entries = findUnverifiableSubmissions([{ label: "S", scores: uniform(8) }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].missing.sort()).toEqual([...PANEL_CRITERION_KEYS].sort());
  });

  it("全軸に根拠があれば空", () => {
    const lensEvidence = Object.fromEntries(PANEL_CRITERION_KEYS.map((k) => [k, `${k} の所見`]));
    expect(findUnverifiableSubmissions([{ label: "S", scores: uniform(8), lensEvidence }])).toEqual(
      [],
    );
  });
});

describe("deriveVetoFindings", () => {
  const canon = {
    specular: "soft sheen",
    shading: "soft gradient",
    lineArt: "thin clean",
    saturation: "moderate",
    colourTemperature: "cool",
  };

  it("描画モデルの変化は V-T", () => {
    const findings = deriveVetoFindings([
      {
        label: "D",
        scores: uniform(9),
        touchComparison: { reference: canon, candidate: { ...canon, shading: "painterly" } },
      },
    ]);
    expect(findings.map((f) => f.id)).toEqual(["V-T"]);
  });

  it("照明由来1項目だけの変化は V-T にせん", () => {
    const findings = deriveVetoFindings([
      {
        label: "W",
        scores: uniform(9),
        touchComparison: { reference: canon, candidate: { ...canon, colourTemperature: "warm" } },
      },
    ]);
    expect(findings).toEqual([]);
  });

  it("照明由来が2つ同時に動いたら V-T", () => {
    const findings = deriveVetoFindings([
      {
        label: "W2",
        scores: uniform(9),
        touchComparison: {
          reference: canon,
          candidate: { ...canon, colourTemperature: "warm", saturation: "garish" },
        },
      },
    ]);
    expect(findings.map((f) => f.id)).toEqual(["V-T"]);
  });

  it("正典から外れた候補だけを名指しし、セット全体を巻き添えにせん", () => {
    const findings = deriveVetoFindings([
      {
        label: "OK",
        scores: uniform(9),
        trademarkComparison: {
          reference: { structureClass: "ハードスプリット", ratio: "50/50" },
          candidate: { structureClass: "ハードスプリット", ratio: "50/50" },
        },
      },
      {
        label: "NG",
        scores: uniform(9),
        trademarkComparison: {
          reference: { structureClass: "ハードスプリット", ratio: "50/50" },
          candidate: { structureClass: "黒筋", ratio: "ほぼ銀" },
        },
      },
    ]);
    expect(findings.map((f) => f.label)).toEqual(["NG"]);
  });
});

describe("normalizedWeightsForIntent", () => {
  it("erotic は仕様どおりの6キー重み", () => {
    expect(normalizedWeightsForIntent("erotic")).toEqual(PANEL_CRITERION_WEIGHTS);
  });

  it("normal は sexual_expression を 0 にし、残りの合計を 1.0 に保つ", () => {
    const weights = normalizedWeightsForIntent("normal");
    expect(weights.sexual_expression).toBe(0);
    const sum = PANEL_CRITERION_KEYS.reduce((total, key) => total + weights[key], 0);
    expect(sum).toBeCloseTo(1, 10);
    // 残った軸の相対比は変えん
    expect(weights.touch / weights.personality).toBeCloseTo(
      PANEL_CRITERION_WEIGHTS.touch / PANEL_CRITERION_WEIGHTS.personality,
      10,
    );
  });
});

describe("deriveSetDriftFindings", () => {
  const touchOf = (shading: string): PanelImageResult["touchComparison"] => ({
    reference: {
      specular: "soft sheen",
      shading: "soft gradient",
      lineArt: "thin clean",
      saturation: "moderate",
      colourTemperature: "cool",
    },
    candidate: {
      specular: "soft sheen",
      shading,
      lineArt: "thin clean",
      saturation: "moderate",
      colourTemperature: "cool",
    },
  });

  // count=1 の提出を繰り返すだけやと、1枚ずつは正典と突き合わせて通っても
  // 採用済みとの不揃いが誰にも判定されんまま溜まる。
  it("採用済みの画像と揃っとらん候補を V-S で名指しする", () => {
    const history = [
      { label: "A1", scores: uniform(8), touchComparison: touchOf("soft gradient") },
      { label: "A2", scores: uniform(8), touchComparison: touchOf("soft gradient") },
    ];
    const candidate = { label: "N", scores: uniform(8), touchComparison: touchOf("painterly") };
    const findings = deriveSetDriftFindings([candidate], history);
    expect(findings.map((f) => f.id)).toEqual(["V-S"]);
    expect(findings[0].label).toBe("N");
  });

  it("採用済みと揃っとる候補は発火しない", () => {
    const history = [
      { label: "A1", scores: uniform(8), touchComparison: touchOf("soft gradient") },
    ];
    const candidate = { label: "N", scores: uniform(8), touchComparison: touchOf("soft gradient") };
    expect(deriveSetDriftFindings([candidate], history)).toEqual([]);
  });

  it("履歴も他候補も無ければ判定材料が無いので発火しない", () => {
    const candidate = { label: "N", scores: uniform(8), touchComparison: touchOf("painterly") };
    expect(deriveSetDriftFindings([candidate], [])).toEqual([]);
  });
});

describe("軸コピー時の実効重み", () => {
  it("identity が総合の過半を握る（順位反転の原因）", () => {
    expect(collapsedIdentityWeight()).toBeCloseTo(0.55, 10);
    expect(collapsedIdentityWeight()).toBeGreaterThan(0.5);
  });

  // 算術の再現であって、割り戻し工程の不具合検出ではない（上の computePanelTotal 参照）。
  it("局長10点の HA が 0点の IB より低く出る順位反転を算術として再現する", () => {
    const ha = computePanelTotal(PRODUCTION_COPIED_SET[0].scores);
    const ib = computePanelTotal(PRODUCTION_COPIED_SET[1].scores);
    expect(ha).toBeLessThan(ib);
    expect(ha).toBeGreaterThan(PANEL_PASS_THRESHOLD);
    expect(ib).toBeGreaterThan(PANEL_PASS_THRESHOLD);
  });
});
