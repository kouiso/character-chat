import { describe, expect, it } from "vitest";

import { measureAll } from "./axes";
import {
  detectTaper,
  formatRate,
  partitionForReport,
  repeatSensitivity,
  renderRepeatSensitivityTable,
  SOURCE_CONFOUND_WARNING,
  groupSummaries,
  mean,
  median,
  rate,
  renderDefectTable,
  renderIntegrityCheck,
  renderLengthVsSlopTable,
  renderTaperSummary,
  summarize,
  toJsonlRecord,
} from "./report";

import type { BenchTurn } from "./corpus";

// golden はここで固定する。実コーパス（.work/e2e-results/）は git 追跡外で CI に無いので、
// 実測値をテストへ焼くと CI で必ず落ちる。実測値は毎回 CLI が出す表の方に残す。
const xml = (action: string, dialogue: string, inner = "内心。"): string =>
  `<response>\n<action>${action}</action>\n<dialogue>${dialogue}</dialogue>\n<inner>${inner}</inner>\n</response>`;

const CONCRETE = "首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込む。";
const SLOPPY = "快感に襲われ、頭が真っ白になった。窓の外の雲を眺めていた。";

const turnOf = (overrides: Partial<BenchTurn>): BenchTurn => ({
  source: "vlong-dogfood",
  run: "run-a",
  // 会話は run ごとに別。既定でひとまとめにすると、別条件の本文と反復判定してまう
  scenario: `${overrides.run ?? "run-a"}/テスト`,
  config: null,
  character: "テスト",
  turn: 1,
  phase: "erotic",
  model: "test/model",
  rawBody: xml(CONCRETE.repeat(6), "「そこ、もっと」"),
  headerVisibleChars: null,
  latencyMs: null,
  error: null,
  finishReason: null,
  lastUserChars: null,
  afterBrokenContext: false,
  origin: "fixture",
  ...overrides,
});

// fixture は設計の要点を1つ含む: sloppy は clean より**長い**のに AI臭が多い。
// 「長さが上がったら合格」では sloppy が勝ってまうことを、テストで固定しとく。
const FIXTURE: BenchTurn[] = [
  turnOf({ run: "clean", turn: 1, rawBody: xml(CONCRETE.repeat(12), "「そこ、もっと」") }),
  turnOf({ run: "clean", turn: 2, rawBody: xml(CONCRETE.repeat(10), "「うん」") }),
  turnOf({ run: "sloppy", turn: 1, rawBody: xml(SLOPPY.repeat(14), "「あっ…んっ」") }),
  turnOf({ run: "sloppy", turn: 2, rawBody: xml(SLOPPY.repeat(12), "「だめ…だめ」") }),
  turnOf({ run: "broken", turn: 1, rawBody: "" }),
  turnOf({ run: "broken", turn: 2, rawBody: xml("頷いた。", "「うん」") }),
];

describe("median / mean / rate", () => {
  it("median は奇数個で中央の値", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("median は偶数個で中央2つの平均。丸めん（比を潰さんため）", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("0〜1 の比を median で出しても 0 や 1 へ潰れん", () => {
    expect(median([0.2, 0.4])).toBeCloseTo(0.3, 10);
    expect(median([0.9, 1])).toBeCloseTo(0.95, 10);
  });

  it("空配列は null（0 と区別する）", () => {
    expect(median([])).toBeNull();
  });

  it("mean は空配列で 0", () => {
    expect(mean([])).toBe(0);
  });

  it("率は必ず分子と分母を持つ", () => {
    expect(formatRate(rate(20, 482))).toBe("20/482 = 4.1%");
  });

  it("分母 0 の率をパーセントで出さん", () => {
    expect(formatRate(rate(0, 0))).toBe("—");
  });
});

describe("summarize", () => {
  const measurements = measureAll(FIXTURE);
  const overall = summarize("全体", measurements);

  it("ターン数を数える", () => {
    expect(overall.turns).toBe(6);
  });

  it("空返信を分母つきで数える", () => {
    expect(formatRate(overall.empty)).toBe("1/6 = 16.7%");
  });

  it("長さ不足を空返信と二重計上せん（分母からも外す）", () => {
    // 床は本番と同じ式（fixture の本文は erotic × medium の 820 字に届かん）。
    // 空返信は **分母にも入れん**。`false`（＝床を満たした）で残すと、
    // HTTP 200 で本文が空のターンが「不足やない」側へ数えられる
    expect(formatRate(overall.tooShort)).toBe("5/5 = 100.0%");
  });

  it("水増しの多い条件が長さでは勝つ（長さ単独を合格基準にでけへん証拠）", () => {
    const byRun = groupSummaries(measurements, "run");
    const clean = byRun.find((s) => s.key === "clean");
    const sloppy = byRun.find((s) => s.key === "sloppy");
    expect(sloppy!.medianVisibleChars!).toBeGreaterThan(clean!.medianVisibleChars!);
    expect(sloppy!.meanSlopPer1000).toBeGreaterThan(clean!.meanSlopPer1000);
    expect(sloppy!.medianSensoryChannels!).toBeLessThan(clean!.medianSensoryChannels!);
  });

  it("ヘッダが無いコーパスでは突き合わせの分母が 0 になる", () => {
    expect(overall.headerMismatch.total).toBe(0);
  });

  it("AI臭は median やのうて平均とターン率で持つ", () => {
    expect(overall.meanSlopPer1000).toBeGreaterThan(0);
    expect(overall.slopHitRate.hits).toBe(2);
  });
});

describe("groupSummaries", () => {
  const measurements = measureAll(FIXTURE);

  it("run 別に分けてキー順で並べる", () => {
    expect(groupSummaries(measurements, "run").map((s) => s.key)).toStrictEqual([
      "broken",
      "clean",
      "sloppy",
    ]);
  });

  it("ターン別に分ける時はゼロ埋めして並び順を保つ", () => {
    expect(groupSummaries(measurements, "turn").map((s) => s.key)).toStrictEqual(["01", "02"]);
  });

  it("phase / model が無いターンを (none) にまとめる", () => {
    const withoutPhase = measureAll([turnOf({ run: "x", phase: null, model: null })]);
    expect(groupSummaries(withoutPhase, "phase")[0].key).toBe("(none)");
    expect(groupSummaries(withoutPhase, "model")[0].key).toBe("(none)");
  });

  it("水増しの多い条件を AI臭で区別できる", () => {
    const byRun = groupSummaries(measurements, "run");
    const clean = byRun.find((s) => s.key === "clean");
    const sloppy = byRun.find((s) => s.key === "sloppy");
    expect(clean?.slopHitRate.hits).toBe(0);
    expect(sloppy?.slopHitRate.hits).toBe(2);
    expect(sloppy?.meanSlopPer1000).toBeGreaterThan(clean?.meanSlopPer1000 ?? 0);
  });
});

describe("renderLengthVsSlopTable", () => {
  const table = renderLengthVsSlopTable(groupSummaries(measureAll(FIXTURE), "run"));

  it("長さ と 水増し を同じ行に並べる（長さだけ見て良いと読めんようにする）", () => {
    const header = table.split("\n")[0];
    expect(header).toContain("median字数");
    expect(header).toContain("AI臭/1000字(平均)");
    expect(header.indexOf("median字数")).toBeLessThan(header.indexOf("AI臭/1000字(平均)"));
  });

  it("不足は率として分母つきで出す", () => {
    expect(table).toMatch(/\d+\/\d+ = \d+\.\d%/);
  });

  it("条件ごとに1行", () => {
    expect(table.split("\n")).toHaveLength(5);
  });
});

describe("renderDefectTable", () => {
  it("死んどる「タグ漏れ」列やのうて、生きとる「タグ構造破損」を出す", () => {
    const header = renderDefectTable(groupSummaries(measureAll(FIXTURE), "run")).split("\n")[0];
    expect(header).toContain("タグ構造破損");
    expect(header).toContain("パース不能");
    expect(header).not.toContain("タグ漏れ");
  });
});

describe("renderIntegrityCheck", () => {
  it("ズレが無ければ 0 と報告する", () => {
    const body = xml(CONCRETE, "「うん」");
    const measurements = measureAll([
      turnOf({
        run: "x",
        rawBody: body,
        headerVisibleChars: measureAll([turnOf({ rawBody: body })])[0].visibleChars,
      }),
    ]);
    expect(renderIntegrityCheck(measurements)).toContain("ズレ 0/1 = 0.0%");
    expect(renderIntegrityCheck(measurements)).toContain("不一致 0/1 = 0.0%");
  });

  it("上限切れのターンは点検の母集団から外す（切れた XML は食い違うのが正常）", () => {
    // max_tokens で途中で切れた応答は XML が閉じてへんので2経路の答えが食い違う。
    // 混ぜると、こっちが決めたトークン上限を「以降の数字が信用でけへん」と報告してまう
    const truncated = turnOf({
      run: "x",
      rawBody: "<response><action>途中で切れ",
      finishReason: "length",
      origin: "capped.txt",
    });
    const clean = turnOf({ run: "x", turn: 2, rawBody: xml(CONCRETE, "「うん」") });
    const rendered = renderIntegrityCheck(measureAll([truncated, clean]));
    expect(rendered).toContain("不一致 0/1 = 0.0%");
    expect(rendered).not.toContain("capped.txt");
  });

  it("経路失敗のターンは点検の母集団から外す（本文が空なら両方0で「一致」になる）", () => {
    // 数え方が2つとも 0 を返すので、点検を通った顔で分母だけ膨らむ。
    // model-ab は 0/560 と出とったが、実際に応答があるのは 479
    const failed = turnOf({ run: "x", rawBody: "", error: "[API_ERROR:502]", origin: "dead.txt" });
    const clean = turnOf({ run: "x", turn: 2, rawBody: xml(CONCRETE, "「うん」") });
    const rendered = renderIntegrityCheck(measureAll([failed, clean]));
    expect(rendered).toContain("不一致 0/1 = 0.0%");
  });

  it("HTTP 200 で本文が空のターンも点検の母集団から外す", () => {
    // error が null なので経路失敗の条件では拾えん。両方の数え方が 0 を返すので、
    // 点検を通った顔で分母だけ膨らむ
    const empty = turnOf({ run: "x", rawBody: "", origin: "empty.txt" });
    const clean = turnOf({ run: "x", turn: 2, rawBody: xml(CONCRETE, "「うん」") });
    expect(renderIntegrityCheck(measureAll([empty, clean]))).toContain("不一致 0/1 = 0.0%");
  });

  it("ズレたら該当ファイルを挙げる", () => {
    const measurements = measureAll([
      turnOf({ run: "x", headerVisibleChars: 1, origin: "bad-file.txt" }),
    ]);
    const rendered = renderIntegrityCheck(measurements);
    expect(rendered).toContain("ズレ 1/1 = 100.0%");
    expect(rendered).toContain("bad-file.txt");
  });
});

describe("detectTaper", () => {
  const chars = (n: number) => xml("あ".repeat(n), "「うん」", `内心${n}。`);
  // run は「同じ条件で回した会話の束」。途中終了は同じ run の他の会話と比べて決まるので、
  // テストでも run と scenario を別に持つ
  const conversation = (scenario: string, lengths: number[], error?: string, run = scenario) =>
    lengths.map((n, index) =>
      turnOf({
        run,
        scenario,
        turn: index + 1,
        rawBody: n === 0 ? "" : chars(n),
        error: n === 0 ? (error ?? null) : null,
      }),
    );

  it("ピークの80%を割ったら尻すぼみ", () => {
    const results = detectTaper(measureAll(conversation("taper", [400, 900, 1000, 300, 200])));
    expect(results[0].peakChars).toBeGreaterThan(900);
    expect(results[0].tapered).toBe(true);
  });

  it("最後まで伸びとる会話は尻すぼみやない", () => {
    const results = detectTaper(measureAll(conversation("grow", [400, 600, 800, 1000, 1200])));
    expect(results[0].tapered).toBe(false);
  });

  it("同じ source で一番進んだ会話より手前で終わっとる会話は判定から外す", () => {
    const results = detectTaper(
      measureAll([
        ...conversation("full", [1200, 900, 800, 700, 650], undefined, "r"),
        ...conversation("cut", [1200, 900, 800], undefined, "r"),
      ]),
    );
    expect(results.find((r) => r.scenario === "cut")?.truncated).toBe(true);
    expect(results.find((r) => r.scenario === "cut")?.tapered).toBe(false);
    expect(results.find((r) => r.scenario === "full")?.truncated).toBe(false);
  });

  it("壊れた期待ターン数で落ちん（配列を確保せん）", () => {
    // 壊れた summary の `turns` はここまでそのまま届く。`Array.from({length})` に
    // 渡しとった間、4294967296 で配列長エラー、少し小さい値でメモリを食い潰した
    const huge = conversation("huge", [900, 800], undefined, "r").map((t) => ({
      ...t,
      config: {
        mode: "session",
        arm: "a",
        responseLength: "medium",
        runId: "1",
        expectedTurns: 4_294_967_296,
        lengthDirective: true,
      },
    }));
    const results = detectTaper(measureAll(huge));
    expect(results.find((r) => r.scenario === "huge")?.truncated).toBe(true);
  });

  it("記録ごと抜けたターンが在る会話は途中終了", () => {
    // 読み込み側は壊れた記録（ターン番号が読めん、座標が重複）を飛ばす。
    // 一番後ろの番号だけ見とった間、真ん中が抜けた会話が完走に見えて、
    // 穴の空いた並びでピーク比を出しとった
    const full = conversation("full", [900, 800, 800, 700, 650], undefined, "r");
    const gapped = conversation("gap", [900, 800, 800, 700, 650], undefined, "r").filter(
      (t) => t.turn !== 3,
    );
    const results = detectTaper(measureAll([...full, ...gapped]));
    expect(results.find((r) => r.scenario === "gap")?.truncated).toBe(true);
    expect(results.find((r) => r.scenario === "full")?.truncated).toBe(false);
  });

  it("エラーが出ても最後まで回った会話は途中終了にせん（model-ab stage0 の13本がこれ）", () => {
    const withMidError = [
      ...conversation("a", [900, 0, 800, 700, 650], "[API_ERROR:502]", "r"),
      ...conversation("b", [900, 800, 800, 700, 650], undefined, "r"),
    ];
    const results = detectTaper(measureAll(withMidError));
    expect(results.find((r) => r.scenario === "a")?.truncated).toBe(false);
  });

  it("表と率は途中終了を分けて出す", () => {
    const rendered = renderTaperSummary(
      detectTaper(
        measureAll([
          ...conversation("taper", [400, 900, 1000, 300, 200], undefined, "r"),
          ...conversation("cut", [1200, 900, 800], undefined, "r"),
        ]),
      ),
    );
    expect(rendered).toContain("途中終了");
    expect(rendered).toContain("1/2 = 50.0%");
  });

  it("経路失敗のターンは尻すぼみの計算から外す", () => {
    // 全ターンが経路失敗の会話は、混ぜるとピーク0字で「尻すぼみやない」と数えられて分母を薄める
    const allFailed = conversation("dead", [0, 0, 0, 0], "[API_ERROR:502]", "r");
    const alive = conversation("alive", [900, 800, 700, 650], undefined, "r");
    const results = detectTaper(measureAll([...allFailed, ...alive]));
    // 結果からは消さん（消すと途中終了の分子・分母からも落ちる）。
    // 尻すぼみを**測れんもの**として分母から外す
    expect(results.map((r) => r.scenario)).toStrictEqual(["alive", "dead"]);
    expect(results.find((r) => r.scenario === "dead")?.taperComputable).toBe(false);
    // 分母は alive の1本だけ。dead を「尻すぼみやない」として混ぜとった時は 1/2 に薄まっとった
    expect(renderTaperSummary(results)).toContain(
      "尻すぼみ（最終2ターンの平均がピークの 80% 未満）: 1/1 = 100.0%",
    );
  });

  it("3ターン未満は尻すぼみを判定せん（ピークと末尾を分けられん）", () => {
    const results = detectTaper(measureAll(conversation("short", [400, 300])));
    expect(results).toHaveLength(1);
    expect(results[0].taperComputable).toBe(false);
  });

  it("ターン番号が逆順で入っても並べ直す", () => {
    const turns = conversation("rev", [1000, 900, 200]);
    const results = detectTaper(measureAll([turns[2], turns[0], turns[1]]));
    expect(results[0].firstTurn).toBe(1);
    expect(results[0].lastTurn).toBe(3);
  });
});

describe("経路の失敗を不良軸から外す", () => {
  const errored = turnOf({ run: "r1", rawBody: "", error: "[API_ERROR:502]" });
  const answered = turnOf({ run: "r1", turn: 2, rawBody: "" });
  const erroredWithBody = turnOf({
    run: "r1",
    turn: 3,
    rawBody: xml("肩を抱き寄せると、指先が背中の汗を辿った。", "「……逃がさない」"),
    error: "stream error: upstream_error",
  });

  it("エラー行は空返信として数えん（6月の 14.5% はインフラ障害やった）", () => {
    const summary = summarize("x", measureAll([errored, answered]));
    expect(formatRate(summary.transportError)).toBe("1/2 = 50.0%");
    expect(formatRate(summary.empty)).toBe("1/1 = 100.0%");
  });

  it("不良軸の分母は応答が返ってきたターンだけ", () => {
    const summary = summarize("x", measureAll([errored, errored, answered]));
    expect(summary.turns).toBe(1);
    expect(summary.empty.total).toBe(1);
  });

  it("本文を出し切ってから落ちた行は測る（応答は実在する）", () => {
    const summary = summarize("x", measureAll([erroredWithBody, answered]));
    expect(formatRate(summary.transportError)).toBe("0/2 = 0.0%");
    expect(summary.turns).toBe(2);
    expect(summary.medianVisibleChars).toBeGreaterThan(0);
  });

  it("表に経路失敗の列がある", () => {
    expect(renderDefectTable([summarize("x", measureAll([errored, answered]))])).toContain(
      "経路失敗",
    );
  });
});

describe("上限切れ（finish_reason: length）", () => {
  const capped = turnOf({
    run: "r1",
    turn: 1,
    rawBody: "<response><action>途中で切れ",
    finishReason: "length",
  });
  const normal = turnOf({
    run: "r1",
    turn: 2,
    rawBody: xml("肩に手を置いた。", "「来てくれたんだ」"),
  });

  it("不良軸の分母から外す（max_tokens はこっちの設定であってモデルの欠陥やない）", () => {
    const summary = summarize("x", measureAll([capped, normal]));
    expect(summary.turns).toBe(1);
    expect(formatRate(summary.lengthCapped)).toBe("1/2 = 50.0%");
    expect(summary.notXml.total).toBe(1);
  });

  it("採点したターンが0件なら実質比を出さん（— であって 0.0000 やない)", () => {
    // 上限切れしか無い run で mean([]) を呼ぶと 0.0000 と印字して、
    // 「ターン内再掲が最大」の顔になる。同じ行が「採点0件」と言うとるのに
    const summary = summarize("x", measureAll([capped]));
    expect(summary.turns).toBe(0);
    expect(summary.meanDistinctRatio).toBeNull();
  });

  it("JSONL に印を残す（下流で切れた XML をモデルのせいにせんため）", () => {
    const record = toJsonlRecord(measureAll([capped])[0]);
    expect(record.finishReason).toBe("length");
    expect(record.lengthCapped).toBe(true);
  });
});

describe("--group-by responseLength", () => {
  it("「長さの指示なし」と記録した run はまとめる（記録が無い run とは別）", () => {
    const noLengthConfig = {
      mode: "session",
      arm: "bench-x",
      responseLength: null,
      runId: "1",
      expectedTurns: 3,
      lengthDirective: false,
    };
    const measurements = measureAll([
      turnOf({ run: "bench-1", scenario: "bench-1/テスト", config: noLengthConfig }),
      turnOf({ run: "bench-2", scenario: "bench-2/テスト", config: noLengthConfig }),
      turnOf({ run: "legacy", scenario: "legacy/テスト", config: null }),
    ]);
    const keys = groupSummaries(measurements, "responseLength").map((s) => s.key);
    expect(keys).toContain("(長さの指示なし)");
    expect(keys.filter((k) => k === "(長さの指示なし)")).toHaveLength(1);
    expect(keys).toContain("(記録なし) legacy");
  });
});

describe("途中終了の期待ターン数", () => {
  const withTurns = (scenario: string, lengths: number[], expectedTurns: number | null) =>
    lengths.map((n, index) =>
      turnOf({
        run: "r",
        scenario,
        turn: index + 1,
        rawBody: xml("あ".repeat(n), "「うん」", `内心${index}。`),
        config: {
          mode: "session",
          arm: "a",
          responseLength: "medium",
          runId: "1",
          expectedTurns,
          lengthDirective: true,
        },
      }),
    );

  it("本文を出し切ってから落ちたターンは尻すぼみの計算に残す", () => {
    // 経路失敗は「error があり、かつ本文が1文字も無い」。`error !== null` だけで切ると、
    // 1234〜1355字を出し切ってから stream error で落ちた4ターンまで捨てて、
    // 手前のターンを会話の末尾として報告してまう（summarize はそれを測っとる）
    const results = detectTaper(
      measureAll([
        ...withTurns("s", [900, 800], 3),
        turnOf({
          run: "r",
          scenario: "s",
          turn: 3,
          rawBody: xml("あ".repeat(1300), "「まだ」", "内心。"),
          error: "stream error: upstream_error",
        }),
      ]),
    );
    // 会話は turn3 で終わっとる。捨てると turn2 が末尾として報告される
    expect(results[0].lastTurn).toBe(3);
    expect(results[0].taperComputable).toBe(true);
    expect(results[0].truncated).toBe(false);
  });

  it("最終ターンが経路失敗なら完走扱いにせん", () => {
    // 記録の在る一番後ろのターン番号で完走を決めとった間、最終ターンが落ちとっても
    // 「最後まで行った」ことになって、その手前の応答を末尾として尻すぼみを判定しとった
    const results = detectTaper(
      measureAll([
        ...withTurns("s", [900, 800, 700], 4),
        turnOf({
          run: "r",
          scenario: "s",
          turn: 4,
          rawBody: "",
          error: "[API_ERROR:502]",
        }),
      ]),
    );
    expect(results[0].truncated).toBe(true);
  });

  it("最終ターンが上限切れなら完走扱いにせん", () => {
    const results = detectTaper(
      measureAll([
        ...withTurns("s", [900, 800, 700], 4),
        turnOf({
          run: "r",
          scenario: "s",
          turn: 4,
          rawBody: xml("あ".repeat(400), "「まだ", "内心"),
          finishReason: "length",
        }),
      ]),
    );
    expect(results[0].truncated).toBe(true);
  });

  it("turn1 で落ちた会話も途中終了に数える（分子からも分母からも消さん）", () => {
    // 入口で3ターン揃うことを求めとった間、turn1・turn2 で落ちた会話は
    // 結果に1行も出んかった。bench:generate は経路失敗でその場で止めるので、
    // turn1 で落ちた10ターンの run が「途中終了 0%」の報告になっとった
    const results = detectTaper(
      measureAll([
        turnOf({
          run: "r",
          scenario: "s1",
          turn: 1,
          rawBody: "",
          error: "API_ERROR",
          config: {
            mode: "session",
            arm: "a",
            responseLength: "medium",
            runId: "1",
            expectedTurns: 10,
            lengthDirective: true,
          },
        }),
      ]),
    );
    expect(results).toHaveLength(1);
    expect(results[0].truncated).toBe(true);
    expect(results[0].taperComputable).toBe(false);
    expect(renderTaperSummary(results)).toContain("1/1 = 100.0%");
  });

  it("完走しとるが有効な応答が3ターン無い会話は尻すぼみの分母から外す", () => {
    // 「測れんかった」を「尻すぼみやない」に混ぜると率が実際より低う出る
    const results = detectTaper(
      measureAll(
        [1, 2].map((turn) =>
          turnOf({
            run: "r",
            scenario: "s2",
            turn,
            rawBody: xml("あ".repeat(400), "「うん」", "内心。"),
            config: {
              mode: "session",
              arm: "a",
              responseLength: "medium",
              runId: "1",
              expectedTurns: 2,
              lengthDirective: true,
            },
          }),
        ),
      ),
    );
    expect(results[0].truncated).toBe(false);
    expect(results[0].taperComputable).toBe(false);
    const rendered = renderTaperSummary(results);
    // 分母が0なので率は出さん（0.0% と印字したら「尻すぼみやなかった」に見える）
    expect(rendered).toContain("尻すぼみ（最終2ターンの平均がピークの 80% 未満）: —");
    expect(rendered).toContain("測れん");
  });

  it("run が宣言したターン数に届いとれば途中終了にせん（--turns 3 の条件を守る）", () => {
    const results = detectTaper(
      measureAll([
        ...withTurns("short", [400, 300, 250], 3),
        ...withTurns("long", [400, 300, 250, 200, 150], 5),
      ]),
    );
    expect(results.find((r) => r.scenario === "short")?.truncated).toBe(false);
  });

  it("宣言に届いてへんかったら途中終了", () => {
    const results = detectTaper(measureAll(withTurns("cut", [400, 300, 250], 10)));
    expect(results[0].truncated).toBe(true);
  });
});

describe("group-by の切り口（宣言された設定）", () => {
  const withConfig = (arm: string, responseLength: string, run: string): BenchTurn =>
    turnOf({
      run,
      config: { mode: "session", arm, responseLength, runId: "1", expectedTurns: null, lengthDirective: true },
    });

  it("設定が記録されとる run は arm / responseLength で束ねる", () => {
    const measurements = measureAll([
      withConfig("phase20", "very_long", "r1"),
      withConfig("phase21", "very_long", "r2"),
    ]);
    expect(groupSummaries(measurements, "responseLength").map((s) => s.key)).toStrictEqual([
      "very_long",
    ]);
    expect(groupSummaries(measurements, "arm").map((s) => s.key)).toStrictEqual([
      "phase20",
      "phase21",
    ]);
  });

  it("設定の記録が無い run は束ねず run 名を残す（別条件を混ぜん）", () => {
    const measurements = measureAll([turnOf({ run: "r1" }), turnOf({ run: "r2" })]);
    expect(groupSummaries(measurements, "responseLength").map((s) => s.key)).toStrictEqual([
      "(記録なし) r1",
      "(記録なし) r2",
    ]);
  });
});

describe("partitionForReport（source 跨ぎの禁止）", () => {
  const mixed = measureAll([
    turnOf({ run: "r1", source: "vlong-dogfood", scenario: "s1" }),
    turnOf({ run: "model-ab-stage1:A", source: "model-ab", scenario: "s2" }),
  ]);

  it("既定では source ごとに分けて、跨いだ集計を出さん", () => {
    const partitions = partitionForReport(mixed, false);
    expect(partitions.map((p) => p.key)).toStrictEqual(["model-ab", "vlong-dogfood"]);
    expect(
      partitions.every((p) => new Set(p.measurements.map((m) => m.turn.source)).size === 1),
    ).toBe(true);
  });

  it("--compare-sources を明示した時だけ1つに束ねる", () => {
    const partitions = partitionForReport(mixed, true);
    expect(partitions).toHaveLength(1);
    expect(partitions[0].measurements).toHaveLength(2);
  });

  it("source が1つなら分割の必要が無い", () => {
    const single = measureAll([turnOf({ run: "r1" })]);
    expect(partitionForReport(single, false)).toHaveLength(1);
  });

  it("跨いだ時の警告文が交絡と category error の両方を名指しする", () => {
    expect(SOURCE_CONFOUND_WARNING).toContain("交絡");
    expect(SOURCE_CONFOUND_WARNING).toContain("API_ERROR");
  });
});

describe("renderDefectTable の除外の注記", () => {
  it("壊れた文脈で外したターン数を表の下に出す", () => {
    // n と経路失敗の分母だけやと、10ターン投げて n=4 の run で残り5ターンが
    // 意図した除外なのか記録の欠落なのか読み手に分からん
    const group = measureAll([
      turnOf({ run: "x", turn: 1 }),
      turnOf({ run: "x", turn: 2, afterBrokenContext: true }),
    ]);
    const rendered = renderDefectTable([summarize("x", group)]);
    expect(rendered).toContain("壊れた文脈の後");
    expect(rendered).toContain("x 1ターン");
  });

  it("外したターンが無い時は注記を出さん", () => {
    const rendered = renderDefectTable([summarize("x", measureAll([turnOf({ run: "x" })]))]);
    expect(rendered).not.toContain("壊れた文脈の後");
  });
});

describe("repeatSensitivity", () => {
  const measurements = measureAll(FIXTURE);

  it("閾値の組を全部出す（句長3 × 一致数2）", () => {
    expect(repeatSensitivity(measurements)).toHaveLength(6);
  });

  it("閾値を上げると発火が増えん（単調）", () => {
    const rows = repeatSensitivity(measurements);
    const loose = rows.find((r) => r.setting.minPhraseLength === 8 && r.setting.minPhrases === 2);
    const strict = rows.find((r) => r.setting.minPhraseLength === 16 && r.setting.minPhrases === 3);
    expect(strict?.flagged.hits ?? 0).toBeLessThanOrEqual(loose?.flagged.hits ?? 0);
  });

  it("表は分母つきで出す", () => {
    // 分母は「比べる相手が在るターン」だけ（1ターン目は測れてへん）
    const judged = measurements.filter((m) => m.repeatLayerAware !== null).length;
    expect(renderRepeatSensitivityTable(measurements)).toContain(`/${judged} =`);
  });

  it("壊れた文脈の後のターンを分母へ入れん（不良表と同じ母集団）", () => {
    // 外さんかった間、隣り合う不良表と感度表が別の母集団を測っとった
    const withBroken = measureAll([
      ...FIXTURE,
      turnOf({ run: "clean", turn: 3, afterBrokenContext: true }),
    ]);
    const judged = measureAll(FIXTURE).filter((m) => m.repeatLayerAware !== null).length;
    expect(repeatSensitivity(withBroken)[0].flagged.total).toBe(judged);
  });
});

describe("toJsonlRecord", () => {
  it("1ターン1行で、判定済みの値だけを残す（本文は残さん）", () => {
    const record = toJsonlRecord(measureAll([turnOf({ run: "x" })])[0]);
    expect(Object.keys(record)).toContain("slopPer1000");
    expect(Object.keys(record)).not.toContain("plainText");
    expect(Object.keys(record)).not.toContain("rawBody");
  });

  it("JSON へ落として読み戻せる", () => {
    const record = toJsonlRecord(measureAll([turnOf({ run: "x" })])[0]);
    expect(JSON.parse(JSON.stringify(record))).toStrictEqual(record);
  });

  it("CLI が品質軸から外した印を残す（同じ母集団を作り直せるように）", () => {
    const record = toJsonlRecord(
      measureAll([turnOf({ run: "x", afterBrokenContext: true })])[0],
    );
    expect(record.afterBrokenContext).toBe(true);
  });

  it("AI臭をカテゴリ別に残す（合計だけやと水増しと定型あえぎが混ざる）", () => {
    const record = toJsonlRecord(
      measureAll([turnOf({ run: "x", rawBody: xml(SLOPPY, "「あっ…んっ」") })])[0],
    );
    expect(record.slopFillerProp).toBe(1);
    expect(record.slopTemplatePhrase).toBe(2);
    expect(record.slopStockMoan).toBe(1);
  });
});
