import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  collectModelAbTurns,
  loadModelAbStages,
  markTurnsAfterBrokenContext,
  MODEL_AB_SCENARIO_CHARACTERS,
  loadVlongDogfood,
  loadRunConfig,
  normalizeTurn,
  parseHeaderLine,
  parseRunSummary,
  parseVlongTurnFile,
  type BenchTurn,
} from "./corpus";

const VLONG_SAMPLE = `# character: Downer
# turn: 3
# intent: conversation
# servedPhase: erotic
# servedModel: deepseek/deepseek-chat
# visibleChars: 253  innerChars: 113  latencyMs: 16311
# error: -
<response>
<action>雨音が窓を叩く。</action>
<dialogue>「……バカじゃないの」</dialogue>
<inner>心配するなんて私らしくない。</inner>
</response>`;

describe("parseHeaderLine", () => {
  it("値が文字列のヘッダは行末まで1つの値として取る", () => {
    const headers = new Map<string, string>();
    parseHeaderLine("# servedModel: deepseek/deepseek-chat", headers);
    expect(headers.get("servedModel")).toBe("deepseek/deepseek-chat");
  });

  it("値に空白を含んでも切らん", () => {
    const headers = new Map<string, string>();
    parseHeaderLine("# error: locator.fill: Timeout 30000ms exceeded", headers);
    expect(headers.get("error")).toBe("locator.fill: Timeout 30000ms exceeded");
  });

  it("数値ヘッダが1行に同居しとる場合は全部拾う", () => {
    const headers = new Map<string, string>();
    parseHeaderLine("# visibleChars: 253  innerChars: 113  latencyMs: 16311", headers);
    expect(headers.get("visibleChars")).toBe("253");
    expect(headers.get("innerChars")).toBe("113");
    expect(headers.get("latencyMs")).toBe("16311");
  });

  it("ヘッダやない行は無視する", () => {
    const headers = new Map<string, string>();
    parseHeaderLine("<response>", headers);
    expect(headers.size).toBe(0);
  });
});

describe("parseVlongTurnFile", () => {
  const turn = parseVlongTurnFile(VLONG_SAMPLE, "sample.txt", "run-a");

  it("ヘッダを型付きで取る", () => {
    expect(turn.character).toBe("Downer");
    expect(turn.turn).toBe(3);
    expect(turn.phase).toBe("erotic");
    expect(turn.model).toBe("deepseek/deepseek-chat");
    expect(turn.headerVisibleChars).toBe(253);
    expect(turn.latencyMs).toBe(16_311);
  });

  it("`error: -` はエラー無しとして null にする", () => {
    expect(turn.error).toBeNull();
  });

  it("本文はヘッダの直後から", () => {
    expect(turn.rawBody.startsWith("<response>")).toBe(true);
    expect(turn.rawBody).not.toContain("# character");
  });

  it("知らん phase は null にする（勝手に既定値を当てん）", () => {
    const parsed = parseVlongTurnFile(
      "# servedPhase: unknownPhase\n<response></response>",
      "x",
      "run-a",
    );
    expect(parsed.phase).toBeNull();
  });

  it("ヘッダが1つも無いファイルでも落ちん", () => {
    const parsed = parseVlongTurnFile("<response>本文だけ</response>", "x", "run-a");
    expect(parsed.rawBody).toBe("<response>本文だけ</response>");
    expect(parsed.turn).toBe(0);
    expect(parsed.headerVisibleChars).toBeNull();
  });

  it("本文が途中で切れとっても落ちん", () => {
    const parsed = parseVlongTurnFile("# turn: 1\n<response>\n<action>途中で", "x", "run-a");
    expect(parsed.rawBody).toBe("<response>\n<action>途中で");
  });

  it("error が実在する時は残す", () => {
    const parsed = parseVlongTurnFile("# error: HTTP 502\n", "x", "run-a");
    expect(parsed.error).toBe("HTTP 502");
  });
});

describe("loadVlongDogfood", () => {
  const root = mkdtempSync(path.join(tmpdir(), "bench-corpus-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("run ディレクトリ名を run として付け、.txt 以外を拾わん", () => {
    mkdirSync(path.join(root, "2026-08-16-final"), { recursive: true });
    writeFileSync(path.join(root, "2026-08-16-final", "Downer-01.txt"), VLONG_SAMPLE, "utf-8");
    writeFileSync(path.join(root, "2026-08-16-final", "rubric.md"), "# 評価軸", "utf-8");
    writeFileSync(path.join(root, "loose-file.txt"), VLONG_SAMPLE, "utf-8");

    const turns = loadVlongDogfood(root);
    expect(turns).toHaveLength(1);
    expect(turns[0].run).toBe("2026-08-16-final");
    expect(turns[0].source).toBe("vlong-dogfood");
    // 会話は run × キャラで1本（ハーネスが通しの会話 id を使い回す）
    // source を混ぜる。bench-run が同じ run 名を使うても会話が混ざらんように
    expect(turns[0].scenario).toBe("vlong-dogfood:2026-08-16-final/Downer");
  });

  it("# turn の無いファイルは飛ばす（全部ターン0に集まって順序が付かんくなる）", () => {
    const runDir = path.join(root, "2026-08-16-noturn");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "Downer-01.txt"), VLONG_SAMPLE, "utf-8");
    writeFileSync(
      path.join(runDir, "Downer-broken.txt"),
      "# character: Downer\n<response><dialogue>「あ」</dialogue></response>",
      "utf-8",
    );

    const turns = loadVlongDogfood(root).filter((t) => t.run === "2026-08-16-noturn");
    expect(turns).toHaveLength(1);
    expect(turns[0].turn).toBeGreaterThan(0);
  });

  it("summary-*.json があれば宣言された設定を各ターンへ付ける", () => {
    const runDir = path.join(root, "2026-08-18-phase24");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, "Downer-01.txt"), VLONG_SAMPLE, "utf-8");
    writeFileSync(
      path.join(runDir, "summary-session-phase24-18831079.json"),
      JSON.stringify({
        mode: "session",
        arm: "phase24",
        runId: "18831079",
        responseLength: "medium",
      }),
      "utf-8",
    );

    const turns = loadVlongDogfood(runDir === "" ? root : root).filter(
      (t) => t.run === "2026-08-18-phase24",
    );
    expect(turns[0].config?.arm).toBe("phase24");
    expect(turns[0].config?.responseLength).toBe("medium");
  });

  it("summary が無い run の設定は null のまま（推測で埋めん）", () => {
    const turns = loadVlongDogfood(root).filter((t) => t.run === "2026-08-16-final");
    expect(turns[0].config).toBeNull();
    expect(loadRunConfig(path.join(root, "2026-08-16-final"))).toBeNull();
  });
});

describe("collectModelAbTurns", () => {
  // 実データの形: fullResults[] の1要素が会話1本（台本 × モデル × 試行）で、
  // その turns[] が7ターン。ターン側の記録に trial が無い。
  const conversation = (scenarioId: string, model: string, trial: number) => ({
    scenarioId,
    model,
    trial,
    turns: [
      { turn: 1, scenarioId, model, servedModel: model, responseText: "本文1", elapsed: 10 },
      { turn: 2, scenarioId, model, servedModel: model, responseText: "本文2" },
    ],
  });

  it("会話1本の turns をターンとして拾う", () => {
    const out: BenchTurn[] = [];
    collectModelAbTurns([conversation("A", "qwen/x", 1)], "stage1", out);
    expect(out.map((t) => t.rawBody)).toStrictEqual(["本文1", "本文2"]);
    expect(out[0].run).toBe("stage1:A");
    expect(out[0].model).toBe("qwen/x");
    expect(out[0].latencyMs).toBe(10);
  });

  it("台本・モデル・試行が違えば別の会話にする（混ぜたら反復判定が別会話と当たる）", () => {
    const out: BenchTurn[] = [];
    collectModelAbTurns(
      [
        conversation("A", "qwen/x", 1),
        conversation("A", "qwen/x", 2),
        conversation("A", "deepseek/y", 1),
        conversation("B", "qwen/x", 1),
      ],
      "stage1",
      out,
    );
    expect(new Set(out.map((t) => t.scenario)).size).toBe(4);
  });

  it("同じ会話のターンは同じ scenario になる", () => {
    const out: BenchTurn[] = [];
    collectModelAbTurns([conversation("A", "qwen/x", 1)], "stage1", out);
    expect(out[0].scenario).toBe(out[1].scenario);
  });

  it("trial が記録に無くても要素の位置で会話を分ける", () => {
    const out: BenchTurn[] = [];
    const withoutTrial = { scenarioId: "A", model: "m", turns: [{ turn: 1, responseText: "x" }] };
    collectModelAbTurns([withoutTrial, withoutTrial], "stage0", out);
    expect(new Set(out.map((t) => t.scenario)).size).toBe(2);
  });

  it("infraError を error として持ち上げる", () => {
    const out: BenchTurn[] = [];
    collectModelAbTurns(
      [{ scenarioId: "A", model: "m", trial: 1, turns: [{ responseText: "x", infraError: true }] }],
      "stage0",
      out,
    );
    expect(out[0].error).toBe("infraError");
  });

  it("null や配列やない入力で落ちん", () => {
    const out: BenchTurn[] = [];
    collectModelAbTurns(null, "stage0", out);
    collectModelAbTurns(undefined, "stage0", out);
    collectModelAbTurns({ fullResults: [] }, "stage0", out);
    expect(out).toHaveLength(0);
  });
});

describe("parseRunSummary", () => {
  it("宣言された設定を取る", () => {
    const config = parseRunSummary(
      JSON.stringify({
        mode: "session",
        arm: "phase24",
        runId: "18831079",
        responseLength: "medium",
      }),
    );
    expect(config).toStrictEqual({
      mode: "session",
      arm: "phase24",
      runId: "18831079",
      responseLength: "medium",
      expectedTurns: null,
      lengthDirective: true,
    });
  });

  it("欠けとる項目は null にする（ファイル名から推測して埋めん）", () => {
    expect(parseRunSummary(JSON.stringify({ arm: "phase2" }))).toStrictEqual({
      mode: null,
      arm: "phase2",
      runId: null,
      responseLength: null,
      expectedTurns: null,
      lengthDirective: true,
    });
  });

  it("配列の summary は設定の記録が無い run として扱う", () => {
    // 配列も typeof === "object" を通る。受けると arm も responseLength も null の
    // config が出来て、壊れた run 同士が `?/?` で1つの群にまとまる
    expect(parseRunSummary("[]")).toBeNull();
    expect(parseRunSummary('[{"arm":"a"}]')).toBeNull();
  });

  it("長さの指示を送っとらん run は lengthDirective:false（床が付かんようにする）", () => {
    // 記録済みのハーネスは必ず送るので、明示的に false と書いてある時だけ false
    expect(parseRunSummary(JSON.stringify({ lengthDirective: false }))?.lengthDirective).toBe(
      false,
    );
    expect(parseRunSummary(JSON.stringify({ arm: "b" }))?.lengthDirective).toBe(true);
  });

  it("回すつもりやったターン数を拾う（途中終了の判定に使う）", () => {
    expect(parseRunSummary(JSON.stringify({ arm: "b", turns: 3 }))?.expectedTurns).toBe(3);
  });

  it("古い記録は `# error` でヘッダを打ち切る（本文の1行目に騙されん）", () => {
    // 古い vlong の記録は `# error` までしか書かん。本文が `# finishReason: length` や
    // `# userChars: 100` で始まると、まだ見てへんキーなのでヘッダとして食うて、
    // **上限切れと床の判定をその行に乗っ取られる**（本文からもその行が消える）
    const legacy = [
      "# character: X",
      "# turn: 3",
      "# error: -",
      "# finishReason: length",
      "# userChars: 100",
      "<response><dialogue>「あ」</dialogue></response>",
    ].join("\n");
    const parsed = parseVlongTurnFile(legacy, "f.txt", "run-a");
    expect(parsed.finishReason).toBeNull();
    expect(parsed.lastUserChars).toBeNull();
    expect(parsed.rawBody).toContain("# finishReason: length");
  });

  it("空行で区切られた記録はその手前までがヘッダ", () => {
    // bench:generate が書く新しい形式。区切りが在る時だけ finishReason と userChars を読む
    const modern = [
      "# character: X",
      "# turn: 3",
      "# error: -",
      "# finishReason: length",
      "# userChars: 100",
      "",
      "# userChars: 9999",
      "<response><dialogue>「あ」</dialogue></response>",
    ].join("\n");
    const parsed = parseVlongTurnFile(modern, "f.txt", "run-a");
    expect(parsed.finishReason).toBe("length");
    expect(parsed.lastUserChars).toBe(100);
    expect(parsed.rawBody.startsWith("# userChars: 9999")).toBe(true);
  });

  it("ヘッダの数値は全体が整数の時だけ受ける", () => {
    // `Number.parseInt` は `1.5` を 1、`1oops` を 1 として通す。通ると `turn >= 1` の
    // 検査もすり抜けて、別のターンの記録が既存の turn 1 へ重なる
    const headerTurn = (raw: string): number =>
      parseVlongTurnFile(`# character: X\n# turn: ${raw}\n本文`, "f.txt", "run-a").turn;
    expect(headerTurn("3")).toBe(3);
    expect(headerTurn("1.5")).toBe(0);
    expect(headerTurn("1oops")).toBe(0);
  });

  it("整数やないターン数は「記録が無い」へ倒す", () => {
    // 負数を通すと `detectTaper` が全部の run を完走と読み、小数は完走した run を
    // 途中終了と読む。どっちも途中終了率を静かに壊す
    for (const turns of [0, -10, 2.5]) {
      expect(parseRunSummary(JSON.stringify({ arm: "b", turns }))?.expectedTurns).toBeNull();
    }
  });

  it("オブジェクトやない JSON では null", () => {
    expect(parseRunSummary("null")).toBeNull();
    expect(parseRunSummary('"文字列"')).toBeNull();
  });
});

describe("MODEL_AB_SCENARIO_CHARACTERS は model-ab-test.ts の写し", () => {
  // 元ファイルをテキストとして読む（import すると BASE_URL を叩くハーネスが走る）
  const SOURCE = readFileSync(path.resolve(import.meta.dirname, "..", "model-ab-test.ts"), "utf-8");

  it("台本 → キャラの対応が元ファイルと一致する（写しが古くなったら落ちる）", () => {
    const parsed: Record<string, string> = {};
    for (const match of SOURCE.matchAll(/id:\s*"([A-Z])",\s*\n\s*char:\s*"([^"]+)"/g)) {
      parsed[match[1]] = match[2];
    }
    expect(parsed).toStrictEqual(MODEL_AB_SCENARIO_CHARACTERS);
  });

  it("A と D は同じキャラ、B と C は別（帰無分布のドナー選びが効く所）", () => {
    expect(MODEL_AB_SCENARIO_CHARACTERS.A).toBe(MODEL_AB_SCENARIO_CHARACTERS.D);
    expect(new Set(Object.values(MODEL_AB_SCENARIO_CHARACTERS)).size).toBe(3);
  });
});

describe("normalizeTurn", () => {
  const base: BenchTurn = {
    source: "model-ab",
    run: "r",
    scenario: "r:A:m:t1",
    afterBrokenContext: false,
    config: null,
    character: "c",
    turn: 1,
    phase: null,
    model: null,
    rawBody: "",
    headerVisibleChars: null,
    latencyMs: null,
    error: null,
    finishReason: null,
    lastUserChars: null,
    origin: "o",
  };

  it("エラーのプレースホルダを本文やのうて error として扱う", () => {
    const normalized = normalizeTurn({ ...base, rawBody: "[API_ERROR:502]" });
    expect(normalized.rawBody).toBe("");
    expect(normalized.error).toBe("[API_ERROR:502]");
  });

  it("INFRA_ERROR も同じ", () => {
    expect(normalizeTurn({ ...base, rawBody: "[INFRA_ERROR:503]" }).rawBody).toBe("");
  });

  it("普通の本文は触らん", () => {
    const normalized = normalizeTurn({ ...base, rawBody: "<response>本文</response>" });
    expect(normalized.rawBody).toBe("<response>本文</response>");
    expect(normalized.error).toBeNull();
  });

  it("既に error がある時は上書きせん", () => {
    const normalized = normalizeTurn({
      ...base,
      rawBody: "[API_ERROR:502]",
      error: "先に記録されたエラー",
    });
    expect(normalized.error).toBe("先に記録されたエラー");
  });
});

describe("model-ab の turn 検証", () => {
  it("turn が1以上やない記録は捨てる（ファイル側と同じ規則）", () => {
    const out: BenchTurn[] = [];
    collectModelAbTurns(
      [
        {
          scenarioId: "A",
          model: "m",
          turns: [
            { turn: 1, responseText: "<response><dialogue>「あ」</dialogue></response>" },
            { turn: 0, responseText: "<response><dialogue>「い」</dialogue></response>" },
            { responseText: "<response><dialogue>「う」</dialogue></response>" },
            { turn: 1.5, responseText: "<response><dialogue>「え」</dialogue></response>" },
          ],
        },
      ],
      "model-ab-stage0",
      out,
    );
    // collect の時点では 0 のまま入る。捨てるのは loadModelAbStages と同じ条件
    expect(out.filter((t) => t.turn >= 1)).toHaveLength(1);
  });
});

describe("壊れた文脈の後のターンへ印を付ける", () => {
  const turn = (scenario: string, n: number, body: string, error: string | null = null) => ({
    source: "bench-run" as const,
    run: "r",
    scenario,
    config: null,
    character: "テスト",
    turn: n,
    phase: "erotic" as const,
    model: "m",
    rawBody: body,
    headerVisibleChars: null,
    latencyMs: null,
    error,
    finishReason: null,
    lastUserChars: null,
    afterBrokenContext: false,
    origin: "fixture",
  });

  const marked = (turns: BenchTurn[]) =>
    markTurnsAfterBrokenContext(turns)
      .filter((t) => t.afterBrokenContext)
      .map((t) => t.turn);

  it("応答が丸ごと落ちたターンより後へ印を付ける（失敗したターン自体は付けん）", () => {
    // 返事が抜けた文脈で続けると user 発話が2つ続く会話になる。
    // generate.ts はそこで止めるのに、読み込み側が古い記録の続きを測っとった
    // **消さずに印を付ける。**消すと、実際に飛んだリクエストが経路失敗率の
    // 分母からも消えて、失敗率が水増しされる
    expect(
      marked([
        turn("s", 1, "<response><dialogue>「あ」</dialogue></response>"),
        turn("s", 2, "", "[API_ERROR:429]"),
        turn("s", 3, "<response><dialogue>「い」</dialogue></response>"),
        turn("s", 4, "<response><dialogue>「う」</dialogue></response>"),
      ]),
    ).toStrictEqual([3, 4]);
  });

  it("後ろが空のターンでも印を付ける（空返信の不良として数えん）", () => {
    // 印を本文のあるターンだけに付けとった間、壊れた文脈のまま投げて空が返った
    // ターンが「モデルが空を返した」不良として数えられとった（error が無いので）
    expect(
      marked([
        turn("s", 1, "<response><dialogue>「あ」</dialogue></response>"),
        turn("s", 2, "", "[API_ERROR:429]"),
        turn("s", 3, ""),
        turn("s", 4, "<response><dialogue>「う」</dialogue></response>"),
      ]),
    ).toStrictEqual([3, 4]);
  });

  it("HTTP 200 で本文が空のターンの後ろも捨てる（error は null）", () => {
    // 返事が抜けたことに変わりはない。generate.ts はその経路でも会話を止める
    expect(
      marked([
        turn("s", 1, "<response><dialogue>「あ」</dialogue></response>"),
        turn("s", 2, ""),
        turn("s", 3, "<response><dialogue>「い」</dialogue></response>"),
      ]),
    ).toStrictEqual([3]);
  });

  it("タグだけで画面に何も出せん返事も会話の切れ目", () => {
    // `hasReadableResponseContent` は外側のタグが無い応答を素テキスト扱いするので、
    // `<action></action>` を「中身あり」と答える。積んで続けたら user 発話が2つ続く
    expect(
      marked([
        turn("s", 1, "<response><dialogue>「あ」</dialogue></response>"),
        turn("s", 2, "<action></action>"),
        turn("s", 3, "<response><dialogue>「い」</dialogue></response>"),
      ]),
    ).toStrictEqual([3]);
  });

  it("上限切れの後ろも捨てる（切れた XML が次の文脈へ入る）", () => {
    // generate.ts は上限切れでも会話を止める。本文があるので isEmpty では拾えん
    const capped = { ...turn("s", 2, "<response><action>途中で切れ"), finishReason: "length" };
    expect(
      marked([
        turn("s", 1, "<response><dialogue>「あ」</dialogue></response>"),
        capped,
        turn("s", 3, "<response><dialogue>「い」</dialogue></response>"),
      ]),
    ).toStrictEqual([3]);
  });

  it("落ち続けたターンは残す（経路失敗率はインフラの実測としてそのまま要る）", () => {
    // 本文が無いので品質軸には入らん。消すと model-ab の6月の障害が
    // 14.5% → 2.6% に化けて、7ターン揃った会話まで途中終了になる
    expect(
      marked([
        turn("s", 1, "", "[API_ERROR:500]"),
        turn("s", 2, "", "[API_ERROR:500]"),
        turn("s", 3, "", "[API_ERROR:500]"),
      ]),
    ).toStrictEqual([]);
  });

  it("本文を出し切ってから落ちたターンは会話を切らん", () => {
    // 経路失敗は「error があり、かつ本文が空」。本文があるなら会話は続いとる
    expect(
      marked([
        turn("s", 1, "<response><dialogue>「あ」</dialogue></response>", "stream error"),
        turn("s", 2, "<response><dialogue>「い」</dialogue></response>"),
      ]),
    ).toStrictEqual([]);
  });

  it("会話ごとに切る（別の会話を巻き込まん）", () => {
    const all = markTurnsAfterBrokenContext([
      turn("a", 1, "", "[API_ERROR:500]"),
      turn("a", 2, "<response><dialogue>「あ」</dialogue></response>"),
      turn("b", 1, "<response><dialogue>「い」</dialogue></response>"),
      turn("b", 2, "<response><dialogue>「う」</dialogue></response>"),
    ]);
    expect(
      all.filter((t) => t.afterBrokenContext).map((t) => `${t.scenario}${t.turn}`),
    ).toStrictEqual(["a2"]);
  });
});

describe("ヘッダと本文の境目", () => {
  it("知らんキーの `# ` 行から本文（壊れた出力を消さん）", () => {
    // 「`# ` で始まる行は全部ヘッダ」で切っとった間、見出しから始まる壊れた応答は
    // その行ごと消えてから測られとった。壊れた出力こそ不良軸が見なあかんもの
    const turn = parseVlongTurnFile(
      ["# character: さくら", "# turn: 3", "# Response", "<dialogue>「あ」</dialogue>"].join("\n"),
      "f.txt",
      "run-a",
    );
    expect(turn.character).toBe("さくら");
    expect(turn.turn).toBe(3);
    expect(turn.rawBody).toContain("# Response");
  });

  it("本文の先頭が既知のキーでもヘッダを上書きせん（2度目は本文）", () => {
    // 知らんキーで切るだけやと、`# character: 別人` で始まる壊れた応答が
    // 記録側のヘッダを上書きして、別の会話・別の位置へ付け替えてまう
    const turn = parseVlongTurnFile(
      [
        "# character: さくら",
        "# turn: 3",
        "# character: 別人",
        "# turn: 9",
        "<dialogue>「あ」</dialogue>",
      ].join("\n"),
      "f.txt",
      "run-a",
    );
    expect(turn.character).toBe("さくら");
    expect(turn.turn).toBe(3);
    expect(turn.rawBody).toContain("# character: 別人");
    expect(turn.rawBody).toContain("# turn: 9");
  });

  it("本文に書かれた `# character:` で会話の振り分けを乗っ取られん", () => {
    const turn = parseVlongTurnFile(
      ["# character: さくら", "<dialogue>「あ」</dialogue>", "# character: 別人"].join("\n"),
      "f.txt",
      "run-a",
    );
    expect(turn.character).toBe("さくら");
  });
});

describe("本文をそのまま持つ", () => {
  it("前後の空白を落とさん（本番は床未満で生の長さを見る）", () => {
    // quality-guard.ts:107 は床が1300字未満の時、生の response.length で比べる。
    // trim すると床際の応答が本番では通るのにここだけ「不足」になる
    const body = "\n  <response><dialogue>「あ」</dialogue></response>  \n";
    const turn = parseVlongTurnFile(`# character: さくら\n# turn: 1${body}`, "f.txt", "r");
    expect(turn.rawBody).toBe(body.slice(1));
  });
});

describe("同じ座標の記録", () => {
  it("model-ab でも同じ会話・同じターンの記録は1本だけ残す", () => {
    // ディレクトリ側だけ直しとった。残すと片方がもう片方の前方履歴になって
    // turn1 に反復が出るし、分母も倍になる。**読み込みの経路ごと**確かめる
    const dir = mkdtempSync(path.join(tmpdir(), "bench-modelab-"));
    const file = path.join(dir, "model-ab-stage0.json");
    writeFileSync(
      file,
      JSON.stringify({
        stage: 0,
        fullResults: [
          {
            scenarioId: "A",
            model: "m",
            turns: [
              { turn: 1, responseText: "<response><dialogue>「あ」</dialogue></response>" },
              { turn: 1, responseText: "<response><dialogue>「あ」</dialogue></response>" },
              { turn: 2, responseText: "<response><dialogue>「い」</dialogue></response>" },
            ],
          },
        ],
      }),
      "utf-8",
    );
    expect(loadModelAbStages([file]).map((t) => t.turn)).toStrictEqual([1, 2]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("同じキャラ・同じターンの .txt が2本あったら後の方を捨てる", () => {
    // 録り直しの控えを同じディレクトリへ置くと、`measureScenario` が同じ位置へ並べて
    // **片方をもう片方の前方履歴**として反復判定する（turn1 に反復が出る）。分母も倍になる
    const dupRoot = mkdtempSync(path.join(tmpdir(), "bench-dup-"));
    mkdirSync(path.join(dupRoot, "run-a"), { recursive: true });
    writeFileSync(path.join(dupRoot, "run-a", "Downer-03.txt"), VLONG_SAMPLE, "utf-8");
    writeFileSync(path.join(dupRoot, "run-a", "Downer-03-copy.txt"), VLONG_SAMPLE, "utf-8");

    expect(loadVlongDogfood(dupRoot)).toHaveLength(1);
    rmSync(dupRoot, { recursive: true, force: true });
  });
});
