import { describe, expect, it } from "vitest";

import {
  GATE_THRESHOLDS,
  allGatesPass,
  buildScenarioRunRecord,
  evaluateGates,
  percentile,
  summarizeLatency,
  summarizeOutcome,
  summarizeRepetition,
  summarizeViolations,
} from "./gate-metrics";

import type { ScenarioResult, TurnResult } from "./types";

const turn = (overrides: Partial<TurnResult> & { turnIndex: number }): TurnResult => ({
  userMsg: "もっと",
  assistantMsg: "リンカは息を荒くしながら、そっと身体を寄せた。",
  expectedPhase: "erotic",
  detectedPhase: "erotic",
  phaseMonotonicViolation: false,
  usedModel: "deepseek/deepseek-chat-v3-0324",
  qualityRetries: 0,
  failedCheck: null,
  renderedMessageCount: 1,
  persistedMessageCount: 1,
  firstTokenMs: 1_200,
  lastChunkMs: 8_000,
  hasDoneSignal: true,
  screenshotPath: "shot.png",
  wallClockMs: 8_200,
  ...overrides,
});

const scenario = (
  scenarioId: string,
  turns: TurnResult[],
  score: number,
  bonusTotal = 20,
  status = "completed",
): ScenarioResult =>
  ({
    scenarioId,
    status,
    turns,
    rubricScore: {
      sceneAlignment: 25,
      eroticDensity: 25,
      characterConsistency: 20,
      escalationNaturalness: 15,
      noMetaRemarks: 15,
      subtextInterpretation: 0,
      bonuses: { creampie: 10, afterglow: 10, image: 0 },
      // #909: ゲートは rawTotal を見るので、helper の score は素点として渡す。
      // eventWeightedTotal はボーナスが乗った参考値として別に持たせる。
      eventWeightedTotal: score + bonusTotal,
      rawTotal: score,
    },
  }) as unknown as ScenarioResult;

// 近似重複の判定を避けるための語彙プール。番号だけ違う定型文やと
// findNearDuplicateMatch が全部を重複と見なして土台が成立せん。
const SUBJECTS = [
  "窓辺の彼女は",
  "汗ばんだ背中が",
  "細い指先が",
  "低い声が",
  "崩れた髪が",
  "熱い息が",
  "白い喉が",
];
const ACTIONS = [
  "ゆっくり傾いて",
  "小刻みに震えて",
  "強く押しつけられ",
  "静かにほどけて",
  "不意に跳ねて",
  "深く沈んで",
];
const SETTINGS = [
  "雨音の残る部屋で。",
  "薄暗い廊下の先で。",
  "冷えたシーツの上で。",
  "西日の差す窓際で。",
  "夜明け前の台所で。",
];

describe("percentile", () => {
  it("空配列では null を返す", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("p95 は上位値を選ぶ", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 95)).toBe(100);
  });
});

describe("summarizeLatency", () => {
  it("TTFB と total の p95、120秒超のターンを数える", () => {
    const turns = [
      turn({ turnIndex: 1, firstTokenMs: 900, lastChunkMs: 5_000 }),
      turn({ turnIndex: 2, firstTokenMs: 1_500, lastChunkMs: 20_000 }),
      turn({ turnIndex: 3, firstTokenMs: 12_000, lastChunkMs: 130_000 }),
    ];
    const result = summarizeLatency(turns);

    expect(result.ttfbSamples).toBe(3);
    expect(result.ttfbP95Ms).toBe(12_000);
    expect(result.totalSamples).toBe(3);
    expect(result.totalP95Ms).toBe(130_000);
    expect(result.slowTurnCount).toBe(1);
    expect(result.slowTurnIndexes).toEqual([3]);
  });

  it("firstTokenMs が null のターンは TTFB 分母から外す", () => {
    const result = summarizeLatency([
      turn({ turnIndex: 1, firstTokenMs: null }),
      turn({ turnIndex: 2, firstTokenMs: 2_000 }),
    ]);
    expect(result.ttfbSamples).toBe(1);
    expect(result.totalSamples).toBe(2);
  });

  it("lastChunkMs が無ければ wallClockMs で total を代替する", () => {
    const result = summarizeLatency([
      turn({ turnIndex: 1, lastChunkMs: null, wallClockMs: 30_000 }),
    ]);
    expect(result.totalP95Ms).toBe(30_000);
  });
});

describe("summarizeRepetition", () => {
  it("完全同文の再出現を数える", () => {
    const body = "リンカは息を荒くしながら、そっと身体を寄せて耳元でささやいた。";
    const result = summarizeRepetition([
      turn({ turnIndex: 1, assistantMsg: body }),
      turn({ turnIndex: 2, assistantMsg: "別の描写がここに続いていく。彼女は視線を落とした。" }),
      turn({ turnIndex: 3, assistantMsg: body }),
    ]);
    expect(result.exactDuplicateCount).toBe(1);
    expect(result.duplicateTurnIndexes).toContain(3);
  });

  it("異なる文面は重複としない", () => {
    const result = summarizeRepetition([
      turn({ turnIndex: 1, assistantMsg: "窓の外は雨で、彼女は静かに本を閉じた。" }),
      turn({ turnIndex: 2, assistantMsg: "翌朝の研究室には薬品の匂いが残っていた。" }),
    ]);
    expect(result.exactDuplicateCount).toBe(0);
    expect(result.nearDuplicateCount).toBe(0);
  });
});

describe("summarizeViolations", () => {
  it("生の拒否をメタ発言と分けて数える", () => {
    const result = summarizeViolations([
      turn({ turnIndex: 1, assistantMsg: "申し訳ありませんが、その描写はできません。" }),
      turn({ turnIndex: 2, assistantMsg: "ロールプレイを続けますね。", failedCheck: null }),
      turn({ turnIndex: 3, assistantMsg: "通常の描写です。", failedCheck: "wrong-first-person" }),
    ]);
    expect(result.refusalCount).toBe(1);
    expect(result.refusalTurnIndexes).toEqual([1]);
    expect(result.metaRemarkCount).toBe(1);
    expect(result.characterBreakCount).toBe(1);
  });

  it("拒否ターンをメタ発言に二重計上しない", () => {
    const result = summarizeViolations([
      turn({
        turnIndex: 1,
        assistantMsg: "申し訳ありません。ポリシーによりお答えできません。",
        failedCheck: "meta_remark",
      }),
    ]);
    expect(result.refusalCount).toBe(1);
    expect(result.metaRemarkCount).toBe(0);
  });
});

describe("summarizeOutcome", () => {
  it("絶頂の後に来た余韻だけを成立とみなす", () => {
    const result = summarizeOutcome([
      turn({ turnIndex: 1, detectedPhase: "erotic" }),
      turn({ turnIndex: 2, detectedPhase: "climax" }),
      turn({ turnIndex: 3, detectedPhase: "afterglow" }),
    ]);
    expect(result.climaxReached).toBe(true);
    expect(result.climaxTurnIndex).toBe(2);
    expect(result.afterglowEstablished).toBe(true);
    expect(result.afterglowTurnIndex).toBe(3);
  });

  it("絶頂に届かなければ余韻も不成立とする", () => {
    const result = summarizeOutcome([
      turn({ turnIndex: 1, detectedPhase: "erotic" }),
      turn({ turnIndex: 2, detectedPhase: "afterglow" }),
    ]);
    expect(result.climaxReached).toBe(false);
    expect(result.afterglowEstablished).toBe(false);
  });
});

describe("evaluateGates", () => {
  // #866 が要求する turn22 以降まで届く長さにしてある。全 run が短いと
  // 「後半を一度も測ってへん」状態になり、後半ゲートは通らん（それが正しい）。
  const cleanRun = (scenarioId: string, runIndex: number) =>
    buildScenarioRunRecord(
      scenario(
        scenarioId,
        Array.from({ length: 25 }, (_, index) => {
          const turnIndex = index + 1;
          const phase =
            turnIndex === 24 ? "climax" : turnIndex === 25 ? "afterglow" : ("erotic" as const);
          return turn({
            turnIndex,
            detectedPhase: phase,
            expectedPhase: phase,
            // 近似重複の判定に引っかからんよう、語も文型も毎ターン変える。
            // 定型文へ番号だけ差し替えると 300 turn 中 288 が重複判定になる。
            assistantMsg: `${SUBJECTS[turnIndex % SUBJECTS.length]}${ACTIONS[turnIndex % ACTIONS.length]}${SETTINGS[turnIndex % SETTINGS.length]}${scenarioId}`,
          });
        }),
        95,
      ),
      { runIndex, runId: `run-${scenarioId}-${runIndex}` },
    );

  const fullSet = ["S4", "S6", "S7", "S8"].flatMap((scenarioId) =>
    [1, 2, 3].map((runIndex) => cleanRun(scenarioId, runIndex)),
  );

  it("12 run が揃い違反ゼロなら全ゲートを通す", () => {
    const verdicts = evaluateGates(fullSet);
    expect(verdicts).toHaveLength(15);
    expect(allGatesPass(verdicts)).toBe(true);
  });

  it("run 数が足りなければ実行回数ゲートが落ちる", () => {
    const verdicts = evaluateGates(fullSet.slice(0, 11));
    const runGate = verdicts.find((verdict) => verdict.gate.includes("各3回"));
    expect(runGate?.pass).toBe(false);
    expect(runGate?.denominator).toBe(12);
  });

  it("非 completed の run はカバレッジに数えず completed ゲートで落とす", () => {
    const failed = buildScenarioRunRecord(
      scenario(
        "S4",
        [
          turn({ turnIndex: 1, detectedPhase: "climax", expectedPhase: "climax" }),
          turn({ turnIndex: 2, detectedPhase: "afterglow", expectedPhase: "afterglow" }),
        ],
        95,
        20,
        "failed",
      ),
      { runIndex: 3, runId: "run-S4-3" },
    );
    const verdicts = evaluateGates([...fullSet.slice(0, 11), failed]);

    const runGate = verdicts.find((verdict) => verdict.gate.includes("各3回"));
    expect(runGate?.pass).toBe(false);
    expect(runGate?.observed).toContain("11 completed runs");

    const statusGate = verdicts.find((verdict) => verdict.gate.includes("completed"));
    expect(statusGate?.pass).toBe(false);
    expect(statusGate?.observed).toBe("S4#3=failed");
  });

  it("同じ runId を並べても実行回数ゲートを通さん", () => {
    const duplicated = ["S4", "S6", "S7", "S8"].flatMap((scenarioId) =>
      [1, 2, 3].map((runIndex) =>
        buildScenarioRunRecord(
          scenario(
            scenarioId,
            [turn({ turnIndex: 1, detectedPhase: "climax", expectedPhase: "climax" })],
            95,
          ),
          { runIndex, runId: "same-run" },
        ),
      ),
    );
    const runGate = evaluateGates(duplicated).find((verdict) => verdict.gate.includes("各3回"));
    expect(runGate?.pass).toBe(false);
  });

  it("p95 は全 run のターンをプールして1回だけ取る", () => {
    const outlier = buildScenarioRunRecord(
      scenario("S4", [turn({ turnIndex: 1, firstTokenMs: 20_000, detectedPhase: "climax" })], 95),
      { runIndex: 1, runId: "run-outlier" },
    );
    // outlier 単体の p95 は 20000ms で閾値超え。ほかの 300 ターンと混ぜた 301 サンプルでは
    // p95 の位置が 1200ms 側に来るため、プールして取る限りゲートは通らなあかん。
    expect(outlier.latency.ttfbP95Ms).toBe(20_000);
    const ttfbGate = evaluateGates([...fullSet, outlier]).find((verdict) =>
      verdict.gate.startsWith("TTFB"),
    );
    expect(ttfbGate?.pass).toBe(true);
    expect(ttfbGate?.observed).toBe("1200ms");
  });

  // 落ちた run の途中の値は「完走した時の速さ」やない。カバレッジと母集団を揃えんと、
  // 詰まって落ちた1本が全体の p95 を押し上げて、完走した11本の速さが見えんくなる。
  it("非 completed の run のターンは速さの母集団に入れん", () => {
    const stalled = buildScenarioRunRecord(
      scenario(
        "S4",
        Array.from({ length: 30 }, (_, index) =>
          turn({
            turnIndex: index + 1,
            firstTokenMs: 90_000,
            lastChunkMs: 300_000,
            detectedPhase: "erotic",
            expectedPhase: "erotic",
            assistantMsg: `途中で詰まった応答${index}`,
          }),
        ),
        95,
        20,
        "failed",
      ),
      { runIndex: 3, runId: "run-stalled" },
    );

    const ttfbGate = evaluateGates([...fullSet, stalled]).find((verdict) =>
      verdict.gate.startsWith("TTFB"),
    );

    expect(ttfbGate?.observed).toBe("1200ms");
    expect(ttfbGate?.pass).toBe(true);
  });

  // 件数は落ちた run のぶんも数えるのに分母だけ completed にすると、表が嘘をつく。
  // 全 run が落ちた時は「0ターン中に拒否3件」という表示になってまう。
  it("欠陥の分母は全 run、速さの分母は completed の run で出す", () => {
    const failed = buildScenarioRunRecord(
      scenario(
        "S4",
        Array.from({ length: 30 }, (_, index) =>
          turn({
            turnIndex: index + 1,
            firstTokenMs: 90_000,
            lastChunkMs: 300_000,
            detectedPhase: "erotic",
            expectedPhase: "erotic",
            assistantMsg: `途中で詰まった応答${index}`,
          }),
        ),
        95,
        20,
        "failed",
      ),
      { runIndex: 3, runId: "run-stalled-denominator" },
    );
    const verdicts = evaluateGates([...fullSet, failed]);

    const refusalGate = verdicts.find((verdict) => verdict.gate.includes("生の拒否"));
    const ttfbGate = verdicts.find((verdict) => verdict.gate.startsWith("TTFB"));
    const slowGate = verdicts.find((verdict) => verdict.gate.includes("秒超の応答"));

    // 落ちた run の30ターンは欠陥の分母に入り、速さの分母には入らん。
    expect(refusalGate?.denominator).toBe(330);
    expect(ttfbGate?.denominator).toBe(300);
    expect(slowGate?.denominator).toBe(300);
  });

  it("完全一致の重複ターンを1件として数える", () => {
    const body = "リンカは息を荒くしながら、そっと身体を寄せて耳元でささやいた。";
    const record = buildScenarioRunRecord(
      scenario(
        "S4",
        [
          turn({ turnIndex: 1, assistantMsg: body, detectedPhase: "climax" }),
          turn({ turnIndex: 2, assistantMsg: body, detectedPhase: "afterglow" }),
        ],
        95,
      ),
      { runIndex: 1, runId: "run-dupe" },
    );
    // 完全一致は near-duplicate 判定でも真になるので、内訳は exact 1 + near 1 になる。
    expect(record.repetition.exactDuplicateCount).toBe(1);
    expect(record.repetition.nearDuplicateCount).toBe(1);

    const dupeGate = evaluateGates([record]).find((verdict) => verdict.gate.includes("同文反復"));
    expect(dupeGate?.observed).toBe("1");
  });

  it("エロwave が閾値未満の run を検出する", () => {
    const low = buildScenarioRunRecord(
      scenario("S4", [turn({ turnIndex: 1, detectedPhase: "climax" })], 80),
      { runIndex: 1, runId: "run-low" },
    );
    const verdicts = evaluateGates([low]);
    const waveGate = verdicts.find((verdict) => verdict.gate.includes("エロwave"));
    expect(waveGate?.pass).toBe(false);
    expect(waveGate?.margin).toContain("80");
    expect(GATE_THRESHOLDS.eroticWaveScore).toBe(90);
  });

  it("素点55点にボーナス35点が乗って90になる run を通さん（#909 の二重計上防止）", () => {
    const padded = buildScenarioRunRecord(
      scenario("S4", [turn({ turnIndex: 1, detectedPhase: "climax" })], 55, 35),
      { runIndex: 1, runId: "run-padded" },
    );
    // 旧実装が見とった eventWeightedTotal はちょうど閾値の90に達する。
    expect(padded.eroticWaveEventWeighted).toBe(90);
    expect(padded.eroticWaveScore).toBe(55);

    const waveGate = evaluateGates([padded]).find((verdict) => verdict.gate.includes("エロwave"));
    expect(waveGate?.pass).toBe(false);
  });

  it("TTFB p95 超過を margin つきで報告する", () => {
    const slow = buildScenarioRunRecord(
      scenario(
        "S6",
        [
          turn({
            turnIndex: 1,
            firstTokenMs: 15_000,
            lastChunkMs: 50_000,
            detectedPhase: "climax",
          }),
        ],
        95,
      ),
      { runIndex: 1, runId: "run-slow" },
    );
    const verdicts = evaluateGates([slow]);
    const ttfbGate = verdicts.find((verdict) => verdict.gate.startsWith("TTFB"));
    expect(ttfbGate?.pass).toBe(false);
    expect(ttfbGate?.margin).toBe("5000ms");
    const totalGate = verdicts.find((verdict) => verdict.gate.startsWith("total"));
    expect(totalGate?.pass).toBe(false);
    expect(totalGate?.margin).toBe("5000ms");
  });

  it("表示まで到達せん画像を独立ゲートで落とす", () => {
    const base = scenario("S6", [turn({ turnIndex: 1, detectedPhase: "climax" })], 95);
    const withImages = {
      ...base,
      imageResults: [
        { turnIndex: 1, novitaUrlReceived: true, r2KeyPersisted: true, reloadDisplayed: true },
        { turnIndex: 2, novitaUrlReceived: true, r2KeyPersisted: true, reloadDisplayed: false },
      ],
    } as unknown as ScenarioResult;

    const record = buildScenarioRunRecord(withImages, { runIndex: 1, runId: "run-image" });
    expect(record.image).toMatchObject({ attempted: 2, delivered: 1, failedTurnIndexes: [2] });

    const gate = evaluateGates([record]).find((verdict) => verdict.gate.includes("生成画像"));
    expect(gate?.pass).toBe(false);
    expect(gate?.observed).toBe("1/2");
  });

  it("画像を1枚も撮らんかった run は画像ゲートを素通しする", () => {
    const record = buildScenarioRunRecord(
      scenario("S7", [turn({ turnIndex: 1, detectedPhase: "climax" })], 95),
      { runIndex: 1, runId: "run-no-image" },
    );
    const gate = evaluateGates([record]).find((verdict) => verdict.gate.includes("生成画像"));
    expect(gate?.pass).toBe(true);
    expect(gate?.observed).toBe("0/0");
  });

  it("120秒超の応答を件数ゲートに反映する", () => {
    const slow = buildScenarioRunRecord(
      scenario("S7", [turn({ turnIndex: 1, lastChunkMs: 121_000, detectedPhase: "climax" })], 95),
      { runIndex: 1, runId: "run-120" },
    );
    const gate = evaluateGates([slow]).find((verdict) => verdict.gate.includes("120"));
    expect(gate?.pass).toBe(false);
    expect(gate?.observed).toBe("1");
  });
});

describe("buildScenarioRunRecord", () => {
  it("phase timeline を turn 単位で残す", () => {
    const record = buildScenarioRunRecord(
      scenario(
        "S8",
        [
          turn({ turnIndex: 1, expectedPhase: "erotic", detectedPhase: "erotic" }),
          turn({ turnIndex: 2, expectedPhase: "climax", detectedPhase: "erotic" }),
        ],
        95,
      ),
      { runIndex: 2, runId: "run-timeline" },
    );

    expect(record.phaseTimeline).toHaveLength(2);
    expect(record.phaseTimeline[1]).toMatchObject({
      turnIndex: 2,
      expectedPhase: "climax",
      detectedPhase: "erotic",
      aligned: false,
    });
    expect(record.eroticWaveScore).toBe(95);
    expect(record.runIndex).toBe(2);
  });
});

describe("summarizeLateTurns (#866)", () => {
  const longRun = (dupAt: number[], slowAt: number[]) =>
    Array.from({ length: 30 }, (_, i) =>
      turn({
        turnIndex: i + 1,
        assistantMsg: dupAt.includes(i + 1)
          ? "同じ描写がここで繰り返される。"
          : `${i + 1}番目の固有の描写。`,
        lastChunkMs: slowAt.includes(i + 1) ? 60_000 : 5_000,
      }),
    );

  it("turn22以降だけの反復を数える", () => {
    // turn5 と turn25 に同文を置く。turn25 側だけが後半の反復として数えられる。
    const record = buildScenarioRunRecord(scenario("S8", longRun([5, 25], []), 95), {
      runIndex: 1,
      runId: "run-late-dup",
    });
    expect(record.lateTurn.startTurn).toBe(22);
    expect(record.lateTurn.turns).toBe(9);
    expect(record.lateTurn.nearDuplicateCount).toBe(1);

    const gate = evaluateGates([record]).find((v) => v.gate.includes("以降の反復"));
    expect(gate?.pass).toBe(false);
    expect(gate?.observed).toBe("1");
  });

  it("前半だけの反復は後半ゲートに出さん", () => {
    const record = buildScenarioRunRecord(scenario("S8", longRun([3, 4], []), 95), {
      runIndex: 1,
      runId: "run-early-dup",
    });
    expect(record.lateTurn.nearDuplicateCount).toBe(0);
    expect(evaluateGates([record]).find((v) => v.gate.includes("以降の反復"))?.pass).toBe(true);
  });

  it("後半だけ遅い run を全体p95に薄めずに落とす", () => {
    // 遅いターンを turn30 の1本だけにする。30件の p95 は index 28 = 5,000ms なので
    // 全体ゲートは通り、後半9件の p95 だけが 60,000ms になる。後半専用の集計を
    // 全体 summary に差し替えたらこのテストは落ちる。
    const record = buildScenarioRunRecord(scenario("S8", longRun([], [30]), 95), {
      runIndex: 1,
      runId: "run-late-slow",
    });
    expect(record.latency.totalP95Ms).toBe(5_000);
    expect(record.lateTurn.totalP95Ms).toBe(60_000);

    const verdicts = evaluateGates([record]);
    expect(verdicts.find((v) => v.gate.startsWith("total p95"))?.pass).toBe(true);
    expect(verdicts.find((v) => v.gate.includes("以降の total p95"))?.pass).toBe(false);
  });

  it("後半で応答が返らんかったターンがあれば total p95 ゲートを通さん", () => {
    const turns = longRun([], []);
    // 失敗ターンは assistantMsg が空で timing も残らん。落ちるのが速いと
    // p95 上は速い標本になってまうため、標本から外して件数で落とす。
    turns[29] = turn({
      turnIndex: 30,
      assistantMsg: "",
      firstTokenMs: null,
      lastChunkMs: null,
      wallClockMs: 800,
    });
    const record = buildScenarioRunRecord(scenario("S8", turns, 95), {
      runIndex: 1,
      runId: "run-late-dead",
    });
    expect(record.lateTurn.unansweredTurns).toBe(1);
    // 落ちたターンの 800ms を後半の応答時間として拾ってへんこと。
    expect(record.lateTurn.totalValuesMs).not.toContain(800);

    const gate = evaluateGates([record]).find((v) => v.gate.includes("以降の total p95"));
    expect(gate?.pass).toBe(false);
    expect(gate?.observed).toBe("応答無し1件");
  });

  it("後半に届かん run は測れてへん扱いにして通さん", () => {
    const record = buildScenarioRunRecord(
      scenario("S4", [turn({ turnIndex: 1, detectedPhase: "climax" })], 95),
      { runIndex: 1, runId: "run-short" },
    );
    const gate = evaluateGates([record]).find((v) => v.gate.includes("以降の total p95"));
    expect(gate?.pass).toBe(false);
    expect(gate?.observed).toBe("後半のturnが無い");
  });
});
