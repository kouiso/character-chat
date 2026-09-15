import { describe, expect, it } from "vitest";

import {
  donorFor,
  marginalRecycledRate,
  parseArgs,
  renderNullModel,
  renderQuartiles,
} from "./analyze";
import { measureAll } from "./axes";

import type { BenchTurn } from "./corpus";

const xml = (action: string, dialogue: string, inner = "内心。"): string =>
  `<response>\n<action>${action}</action>\n<dialogue>${dialogue}</dialogue>\n<inner>${inner}</inner>\n</response>`;

const turnOf = (overrides: Partial<BenchTurn>): BenchTurn => ({
  source: "vlong-dogfood",
  run: "run-a",
  scenario: `${overrides.run ?? "run-a"}/テスト`,
  config: null,
  character: "テスト",
  turn: 1,
  phase: "erotic",
  model: "test/model",
  rawBody: xml("首筋に唇を這わせると、喉の奥から細い声が漏れた。", "「そこ、もっと」"),
  headerVisibleChars: null,
  latencyMs: null,
  error: null,
  finishReason: null,
  lastUserChars: null,
  afterBrokenContext: false,
  origin: "fixture",
  ...overrides,
});

/**
 * 比べる相手が居らんターンは測れんので、fixture の会話には**必ず先頭のターン**を置く。
 * 先頭は反復せん別の本文にして、測りたいターンを2ターン目へ送る
 */
const LEAD_BODY = xml("窓の外で雨粒が屋根を叩いて、遠くで電車の音がした。", "「ん」");
const withLead = (turn: BenchTurn): BenchTurn[] => [
  turnOf({
    scenario: turn.scenario,
    run: turn.run,
    turn: 1,
    config: turn.config,
    character: turn.character,
    phase: turn.phase,
    model: turn.model,
    rawBody: LEAD_BODY,
  }),
  { ...turn, turn: 2 },
];

describe("帰無分布のドナー選び", () => {
  const scenarioOf = (key: string): [string, BenchTurn[]] => [
    key,
    [1, 2, 3].map((turn) => turnOf({ scenario: key, turn, character: "同じ子" })),
  ];

  it("候補の並び順が変わっても同じドナーを選ぶ（再導出できることが売りの台やから）", () => {
    // 候補の順序は readdirSync 由来。別のファイルシステムへ置き直すと順序が変わるので、
    // 配列の位置で選んどった間は同じコーパス・同じ seed で帰無率が動いとった
    const forward = [scenarioOf("a/x"), scenarioOf("b/y"), scenarioOf("c/z")];
    const reversed = [...forward].reverse();
    for (const seed of [0, 1, 2, 7, 13]) {
      expect(donorFor(forward, "a/x", "同じ子", 3, seed, 2)[0].scenario).toBe(
        donorFor(reversed, "a/x", "同じ子", 3, seed, 2)[0].scenario,
      );
    }
  });

  it("必要な本数はドナーの穴を許す（受け手の履歴が薄い時に選べんくならん）", () => {
    // 受け手の prefix に経路失敗が混じっとると、実測側の履歴は index より少ななる。
    // ドナー側だけ「prefix が全部測れる」ことを求めると、比べとるのが
    // 「別会話かどうか」やのうて「履歴が何本あるか」になる
    const gapped: [string, BenchTurn[]] = [
      "b/y",
      [
        turnOf({ scenario: "b/y", turn: 1, character: "同じ子" }),
        turnOf({ scenario: "b/y", turn: 2, character: "同じ子", rawBody: "" }),
        turnOf({ scenario: "b/y", turn: 3, character: "同じ子" }),
      ],
    ];
    // 穴があるので測れるのは3ターン中2本。受け手も2本しか持っとらんなら選べる
    expect(donorFor([scenarioOf("a/x"), gapped], "a/x", "同じ子", 4, 0, 2)).not.toStrictEqual([]);
    // 3本要るなら足りん
    expect(donorFor([scenarioOf("a/x"), gapped], "a/x", "同じ子", 4, 0, 3)).toStrictEqual([]);
  });

  it("必要な本数に足りんドナーは選ばん", () => {
    const short: [string, BenchTurn[]] = [
      "b/y",
      [turnOf({ scenario: "b/y", turn: 1, character: "同じ子" })],
    ];
    expect(donorFor([scenarioOf("a/x"), short], "a/x", "同じ子", 4, 0, 3)).toStrictEqual([]);
  });

  it("shuffle ごとに別のドナーを引く（「N回平均」が同じ対照の N 連発にならん）", () => {
    // `seed * 7 + 1` を渡しとった間、ドナーが**ちょうど7本**の時に
    // `(seed * 7 + 1 + len) % 7` が seed によらず一定になって、--shuffles を
    // いくら増やしても同じドナーを引き直すだけやった。
    // 受け手の turn2 と**同じ句を持つ turn1** を1本のドナーだけに置く。
    // 全ドナーを舐めれば帰無率は 0% でも 100% でもない値になる
    const shared = "首筋に唇を這わせると、喉の奥から細い声が漏れた。爪が背中に食い込んだ。";
    const unrelated = "窓の外では雨が屋根を叩いとった。遠くで電車の音がした。";
    const conversation = (key: string, holdsShared: boolean): BenchTurn[] => [
      turnOf({
        scenario: key,
        run: key,
        turn: 1,
        character: "同じ子",
        rawBody: xml(holdsShared ? shared : unrelated, "「そこ」"),
      }),
      turnOf({
        scenario: key,
        run: key,
        turn: 2,
        character: "同じ子",
        rawBody: xml(shared, "「もっと」"),
      }),
    ];
    const corpus = [
      ...conversation("a/x", false),
      ...Array.from({ length: 7 }, (_, i) => conversation(`d${i}/y`, i === 0)).flat(),
    ];
    const rendered = renderNullModel(corpus, 7);
    // 列は「実測（全ターン） / 実測（対照が取れた分） / 帰無」。帰無は最後の列
    const nullRate = /句反復（8字2句） \| [^|]+ \| [^|]+ \| ([\d.]+)%/.exec(rendered)?.[1];
    expect(nullRate).toBeDefined();
    // ドナーを1本しか引かんかったら 0% か、その1本が d0 やったら高止まりする
    expect(Number(nullRate)).toBeGreaterThan(0);
    expect(Number(nullRate)).toBeLessThan(100);
  });

  it("モデルと宣言設定が違う会話はドナーにせん", () => {
    // 語彙と長さの基準が変わる物を跨いでドナーにすると、帰無側だけ
    // 「そもそも似てへん本文」になって、実測との差が実際より大きく出る
    const withMeta = (key: string, model: string, len: string): [string, BenchTurn[]] => [
      key,
      [1, 2, 3].map((turn) =>
        turnOf({
          scenario: key,
          turn,
          character: "同じ子",
          model,
          config: {
            mode: "session",
            arm: key,
            responseLength: len,
            runId: "1",
            expectedTurns: 10,
            lengthDirective: true,
          },
        }),
      ),
    ];
    const me = withMeta("a/x", "m1", "very_long");
    const sameModelSameLen = withMeta("b/y", "m1", "very_long");
    const otherModel = withMeta("c/z", "m2", "very_long");
    const otherLen = withMeta("d/w", "m1", "medium");

    expect(donorFor([me, otherModel, otherLen], "a/x", "同じ子", 3, 0, 2)).toStrictEqual([]);
    expect(donorFor([me, sameModelSameLen], "a/x", "同じ子", 3, 0, 2)[0].scenario).toBe("b/y");
  });

  it("同じキャラの別会話が無ければ空（帰無 0% と印字せんための入口）", () => {
    expect(donorFor([scenarioOf("a/x")], "a/x", "同じ子", 3, 0, 2)).toStrictEqual([]);
  });

  it("会話が1本しか無いコーパスでは帰無分布を作らん（1ターン目も測らん）", () => {
    // 履歴の要らん1ターン目を空履歴で通しとった間、bench-run のように
    // キャラに会話が1本しか無いコーパスで「帰無 0.0%（1ターン）」が出とった。
    // **対照を取っとらんのに数字が出る**のが一番あかん
    const alone = [1, 2].map((turn) =>
      turnOf({ scenario: "only/x", run: "only", turn, character: "ひとりだけ" }),
    );
    expect(renderNullModel(alone, 3)).toContain("帰無分布を作れんかった");
  });
});

describe("帰無分布のドナーは phase の並びも揃える", () => {
  it("同じ位置で phase が違う会話をドナーにせん", () => {
    // 同じキャラ・同じモデル・同じ宣言設定でも、同じターン位置で erotic に入っとる
    // 会話と conversation のままの会話がある（baseline/Downer と phase3/Downer）。
    // 語彙が最初から重ならん相手を対照にすると、帰無側が下振れする
    const eroticRun = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "a/x", run: "a", turn, character: "同じ子", phase: "erotic" }),
    );
    const conversationRun = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "b/y", run: "b", turn, character: "同じ子", phase: "conversation" }),
    );
    const entries: [string, BenchTurn[]][] = [
      ["a/x", eroticRun],
      ["b/y", conversationRun],
    ];
    expect(donorFor(entries, "a/x", "同じ子", 3, 0, 2)).toStrictEqual([]);

    const sameHistory = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "c/z", run: "c", turn, character: "同じ子", phase: "erotic" }),
    );
    // 返るのは**渡す履歴そのもの**（受け手の turn3 より前の2ターン）
    expect(donorFor([...entries, ["c/z", sameHistory]], "a/x", "同じ子", 3, 0, 2)).toStrictEqual(
      sameHistory.slice(0, 2),
    );
  });
});

describe("ドナーは履歴のモデルの並びも揃える", () => {
  it("途中でモデルが変わる会話をドナーにせん", () => {
    // 会話の途中でモデルが変わる run が実際にある（phase17 と phase19 は Qwen と
    // DeepSeek が混ざる）。先頭のターンだけ見とった間、DeepSeek の履歴が
    // Qwen の履歴に差し替わっとった
    const me: [string, BenchTurn[]] = [
      "a/x",
      [1, 2, 3].map((turn) =>
        turnOf({ scenario: "a/x", run: "a", turn, character: "同じ子", model: "m1" }),
      ),
    ];
    const switcher: [string, BenchTurn[]] = [
      "b/y",
      [1, 2, 3].map((turn) =>
        turnOf({
          scenario: "b/y",
          run: "b",
          turn,
          character: "同じ子",
          // 先頭は同じでも、2ターン目から別モデル
          model: turn === 1 ? "m1" : "m2",
        }),
      ),
    ];
    expect(donorFor([me, switcher], "a/x", "同じ子", 3, 0, 2)).toStrictEqual([]);
  });
});

describe("ドナーの履歴はターン番号で切る", () => {
  it("穴の在るドナーから受け手と同じ位置・後ろのターンを渡さん", () => {
    // 配列の位置で切っとった間、ドナーが (1,3,4) やと受け手の turn3 を測る時に
    // ドナーの turn3・turn4 まで「前方履歴」として渡して、帰無率が高う出とった
    const gappedDonor: [string, BenchTurn[]] = [
      "b/y",
      [1, 3, 4].map((turn) => turnOf({ scenario: "b/y", run: "b", turn, character: "同じ子" })),
    ];
    const me: [string, BenchTurn[]] = [
      "a/x",
      [1, 2, 3].map((turn) => turnOf({ scenario: "a/x", run: "a", turn, character: "同じ子" })),
    ];
    // 受け手は turn3 で、前方履歴は2本要る。ドナーが持っとる前方は turn1 だけなので
    // **選べん**。配列の位置で切っとった間は turn1 と turn3 を渡して選べてまうとった
    expect(donorFor([me, gappedDonor], "a/x", "同じ子", 3, 0, 2)).toStrictEqual([]);
    // 穴の無いドナーなら turn1・turn2 を渡す
    const whole: [string, BenchTurn[]] = [
      "c/z",
      [1, 2, 3].map((turn) => turnOf({ scenario: "c/z", run: "c", turn, character: "同じ子" })),
    ];
    expect(donorFor([me, whole], "a/x", "同じ子", 3, 0, 2).map((t) => t.turn)).toStrictEqual([1, 2]);
  });
});

describe("帰無分布の注記", () => {
  it("外した数は「測れとったのにドナーが居らん」ターンだけ言う", () => {
    // `skipped` は履歴の無い1ターン目も数えるので、実測の分母から落ちた数と合わん
    const withDonor = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "a/x", run: "a", turn, character: "同じ子" }),
    );
    const donor = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "b/y", run: "b", turn, character: "同じ子" }),
    );
    const orphan = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "c/z", run: "c", turn, character: "同じ子", model: "other/model" }),
    );
    const rendered = renderNullModel([...withDonor, ...donor, ...orphan], 1);
    // 実測6ターン − 対照が取れた4ターン = 2。1ターン目の3件は元から分母の外
    expect(rendered).toContain("差し替える相手が居らん 2 ターン");
  });

  it("判定でける本文が無い時は「別会話を集めろ」と言わん", () => {
    // 8字以上の句が無い短い掛け合いばかりのコーパス。ドナーは居る
    const short = "<response><dialogue>「うん」</dialogue></response>";
    const corpus = ["a/x", "b/y"].flatMap((scenario) =>
      [1, 2].map((turn) =>
        turnOf({ scenario, run: scenario, turn, character: "同じ子", rawBody: short }),
      ),
    );
    const rendered = renderNullModel(corpus, 1);
    expect(rendered).toContain("判定でけるターンが無い");
    expect(rendered).not.toContain("別会話が1本も無い");
  });
});

describe("帰無側も記録の穴を見る", () => {
  it("穴の後のターンは帰無分布にも入れん", () => {
    // `measureScenario` は穴の後を測らんのに、`renderNullModel` だけ測っとった
    const withGap = [1, 3].map((turn) =>
      turnOf({ scenario: "a/x", run: "a", turn, character: "同じ子" }),
    );
    const donor = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "b/y", run: "b", turn, character: "同じ子" }),
    );
    const rendered = renderNullModel([...withGap, ...donor], 1);
    // 穴の在る会話からは1ターンも入らんので、分母はドナー側の turn2,3 だけ
    const row = /句反復（8字2句） \| ([^|]+) \|/.exec(rendered);
    expect(row?.[1]).toContain("/2");
  });
});

describe("帰無と比べる母集団", () => {
  it("実測を「対照が取れた分」でも出す（帰無だけ分母を絞っとった）", () => {
    // ドナーの居らんターンを帰無側は外すのに実測は入れとった。外れたターンの
    // 反復率が違えば、その差のぶんだけ「実測 − 帰無」が偏る
    const withDonor = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "a/x", run: "a", turn, character: "同じ子" }),
    );
    const donor = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "b/y", run: "b", turn, character: "同じ子" }),
    );
    // モデルが違うのでドナーになれん＝帰無側の分母から外れる会話
    const orphan = [1, 2, 3].map((turn) =>
      turnOf({ scenario: "c/z", run: "c", turn, character: "同じ子", model: "other/model" }),
    );
    const rendered = renderNullModel([...withDonor, ...donor, ...orphan], 1);
    const row = /句反復（8字2句） \| ([^|]+) \| ([^|]+) \|/.exec(rendered);
    // 分母は「比べる相手が在るターン」だけ（3会話 × turn2,3 = 6）。
    // 対照が取れるのはドナーの居る2会話ぶん（4ターン）
    expect(row?.[1]).toContain("/6");
    expect(row?.[2]).toContain("/4");
  });
});

describe("限界再掲率のセルの数え方", () => {
  it("セル内で長さが動いてへんセルは数に入れん", () => {
    const CONST_CONFIG = {
      mode: "session",
      arm: "a",
      responseLength: "very_long",
      runId: "1",
      expectedTurns: 10,
      lengthDirective: true,
    };
    // 同じ層に3ターン。字数が全部同じなので傾きへ1文字も寄与せん
    const constant = [0, 1, 2].flatMap((index) =>
      withLead(
        turnOf({
          run: `c${index}`,
          scenario: `c${index}/テスト`,
          turn: 1,
          config: CONST_CONFIG,
          rawBody: xml("あ".repeat(500), "「うん」"),
        }),
      ),
    );
    const result = marginalRecycledRate(measureAll(constant));
    expect(result.slope).toBeNull();
    expect(result.cells).toBe(0);
    expect(result.constantCells).toBe(1);
  });
});

describe("長さ四分位", () => {
  // 層は ターン位置 × arm × 宣言設定 × モデル。fixture も設定を持たなあかん
  const CONFIG = {
    mode: "session",
    arm: "a",
    responseLength: "very_long",
    runId: "1",
    expectedTurns: 10,
    lengthDirective: true,
  };
  // ターン位置ごとに、長さだけが違う4件を置く。ターン位置と長さは独立。
  // **各会話の先頭に1ターン置く**（比べる相手が居らんターンは測れんので、
  // 測りたいターンは必ず2ターン目以降に来る）。先頭は反復せん別の本文にする
  const LEAD = "窓の外で雨粒が屋根を叩いて、遠くで電車の音がした。";
  const stratified = (positions: number[], lengths: number[]): BenchTurn[] => {
    const leads = lengths.map((_, index) =>
      turnOf({
        scenario: `run-${index}/テスト`,
        run: `run-${index}`,
        turn: 1,
        config: CONFIG,
        rawBody: xml(LEAD, "「ん」"),
      }),
    );
    return [
      ...leads,
      ...positions.flatMap((turn) =>
        lengths.map((length, index) =>
          turnOf({
            scenario: `run-${index}/テスト`,
            run: `run-${index}`,
            turn: turn + 1,
            config: CONFIG,
            rawBody: xml("あ".repeat(length), "「うん」"),
          }),
        ),
      ),
    ];
  };

  it("層ごとに切ってから束ねる（束ねた層の数を明記する）", () => {
    const rendered = renderQuartiles(
      measureAll(stratified([1, 2, 3], [100, 200, 400, 800, 1200, 1600, 2000, 2400])),
    );
    expect(rendered).toContain("束ねた層 3 個");
    // 各層8件 × 3層 = 24件が、4つの四分位へ6件ずつ
    expect(rendered).toContain("| 6 |");
  });

  it("キャラと phase が違うターンを同じ層へ入れん", () => {
    // キャラシートも台本も phase ごとの指示も、長さと反復の**両方**を動かす。
    // 混ぜると、その差が「長さの効果」として四分位に出る
    const mixed = [
      ...stratified([1], [100, 200, 400, 800]).map((t) => ({ ...t, character: "Downer" })),
      ...stratified([1], [1200, 1600, 2000, 2400]).map((t) => ({
        ...t,
        character: "Sakura",
        phase: "conversation" as const,
        scenario: `sakura-${t.run}/テスト`,
      })),
    ];
    const rendered = renderQuartiles(measureAll(mixed));
    expect(rendered).toContain("件数が足りん 8 ターン");
  });

  it("件数の足りん層は外して、外した件数を言う", () => {
    // 足りん層は**別の arm** として置く（同じ層へ入ると数が足りてまう）
    const sparseConfig = { ...CONFIG, arm: "sparse" };
    const sparse = [500, 900].flatMap((length) =>
      withLead(
        turnOf({
          run: `sparse-${length}`,
          scenario: `sparse-${length}/テスト`,
          turn: 1,
          config: sparseConfig,
          rawBody: xml("あ".repeat(length), "「うん」"),
        }),
      ),
    );
    const rendered = renderQuartiles(
      measureAll([...stratified([1], [100, 200, 400, 800, 1200, 1600, 2000, 2400]), ...sparse]),
    );
    expect(rendered).toContain("束ねた層 1 個");
    expect(rendered).toContain("件数が足りん 2 ターン");
  });

  it("同じ字数の並びを固定する（ファイルシステムの順に依存せん）", () => {
    // 境界に**同じ字数で反復の有無が違う**ターンが跨っとると、比較が 0 を返した時に
    // 元の順（readdirSync 由来）が残って、別の観測が別の四分位へ入る。
    // 実コーパスにも1109字の turn8 が2本、Q1/Q2 の境界におる
    const echoed = "首筋に唇を這わせると、喉の奥から細い声が漏れた。";
    const fresh = "窓の外で雨粒が屋根を叩いて、遠くで電車の音がし。";
    expect(fresh.length).toBe(echoed.length);
    // 反復するかどうかは**キー**で決める。配列の位置で決めると、並べ替えた時に
    // 反復する会話そのものが入れ替わって、比べ物にならん。
    const pair = (key: string): BenchTurn[] => {
      // 前半だけ反復させる。1本おきにすると、並べ替えても各四分位の内訳が
      // 変わらんので、順序を固定でけてへんことをテストが見逃す
      const echo = Number(/\d+/.exec(key)?.[0]) < 4;
      return [
        turnOf({ scenario: key, run: key, turn: 1, config: CONFIG, rawBody: xml(echoed, "「そこ」") }),
        // 2ターン目は**どれも同じ字数**。違うのは前ターンの句を戻すかどうかだけ
        turnOf({
          scenario: key,
          run: key,
          turn: 2,
          config: CONFIG,
          rawBody: xml(echo ? echoed : fresh, "「もっと」"),
        }),
      ];
    };
    const keys = Array.from({ length: 8 }, (_, i) => `run-${i}/テスト`);
    const forward = renderQuartiles(measureAll(keys.flatMap(pair)));
    const reversed = renderQuartiles(measureAll([...keys].reverse().flatMap(pair)));
    expect(forward).toBe(reversed);
  });

  it("arm が違うターンを同じ層にせん（arm のプロンプト差が長さと共線）", () => {
    // ターン位置だけ揃えても足りん。arm・宣言設定・モデルも長さと反復の両方を動かす
    const cfg = (arm: string) => ({
      mode: "session",
      arm,
      responseLength: "very_long",
      runId: "1",
      expectedTurns: 10,
      lengthDirective: true,
    });
    const halfPerArm = ["a", "b"].flatMap((arm) =>
      Array.from({ length: 4 }, (_, i) =>
        turnOf({
          scenario: `${arm}-${i}/テスト`,
          run: `${arm}-${i}`,
          turn: 1,
          config: cfg(arm),
          rawBody: xml("あ".repeat(200 * (i + 1)), "「うん」"),
        }),
      ).flatMap(withLead),
    );
    // 8件あるが arm で割れて4件ずつ。層としては小さすぎる
    const rendered = renderQuartiles(measureAll(halfPerArm));
    expect(rendered).toContain("四分位を出せん");
    expect(rendered).toContain("件数が足りん 8 ターン");
  });

  it("箱が1つでも空になる層は四分位にせん", () => {
    // 同着の塊を割らんまま置くと箱が空くことがある。
    // 字数 [1,1,1,1,1,2,3,4] は Q1・Q3・Q4・Q4 に落ちて Q2 が空になり、
    // 空の箱へ「median 0」を印字してまう
    const lengths = [100, 100, 100, 100, 100, 200, 300, 400];
    const rendered = renderQuartiles(
      measureAll(
        lengths.map((n, i) =>
          turnOf({
            scenario: `run-${i}/テスト`,
            run: `run-${i}`,
            turn: 1,
            rawBody: xml("あ".repeat(n), "「うん」"),
          }),
        ),
      ),
    );
    expect(rendered).toContain("四分位を出せん");
  });

  it("設定の記録が無いターンは層を作れん（model-ab は config が丸ごと無い）", () => {
    // `(記録なし)` で埋めると、stage も台本もキャラも混ざったまま
    // 「モデルとターンが同じ」だけで1つの層になる。限界再掲率と同じ規則
    const configless = Array.from({ length: 8 }, (_, i) =>
      turnOf({
        scenario: `run-${i}/テスト`,
        run: `run-${i}`,
        turn: 1,
        config: null,
        rawBody: xml("あ".repeat(200 * (i + 1)), "「うん」"),
      }),
    );
    const rendered = renderQuartiles(measureAll(configless));
    expect(rendered).toContain("四分位を出せん");
    expect(rendered).toContain("設定の記録が無くて層を作れんターンが 8 件");
  });

  it("字数が揃いすぎの層は四分位にせん（順序が長さやのうて並び順で決まる）", () => {
    // 全部同じ字数やと「順序のついた4つの箱」が出るが、その差は並び順でしかない
    const same = Array.from({ length: 8 }, (_, i) =>
      turnOf({
        scenario: `run-${i}/テスト`,
        run: `run-${i}`,
        turn: 1,
        config: CONFIG,
        rawBody: xml("あ".repeat(300), "「うん」"),
      }),
    ).flatMap(withLead);
    const rendered = renderQuartiles(measureAll(same));
    expect(rendered).toContain("四分位を出せん");
    expect(rendered).toContain("字数が揃いすぎ 8 ターン");
  });

  it("本文を出し切ってから落ちたターンは母集団に残す", () => {
    // summarize も尻すぼみも測っとるのに、ここだけ error で切ると別の母集団になる
    const turns = Array.from({ length: 8 }, (_, i) =>
      turnOf({
        scenario: `run-${i}/テスト`,
        run: `run-${i}`,
        turn: 1,
        config: CONFIG,
        rawBody: xml("あ".repeat(100 * (i + 1)), "「うん」"),
        error: i === 0 ? "stream error: upstream_error" : null,
      }),
    ).flatMap(withLead);
    expect(renderQuartiles(measureAll(turns))).toContain("束ねた層 1 個");
  });

  it("どの層も件数が足りんかったら四分位を出さん", () => {
    // 一括で切っとった実装なら 8件あるので表を出してまう。
    // ターン位置を固定でけへんのに長さの効果を語ったらあかん
    const rendered = renderQuartiles(
      measureAll(
        [1, 2, 3, 4].map((turn) =>
          turnOf({ scenario: `s${turn}/テスト`, run: `s${turn}`, turn, rawBody: xml("あ".repeat(turn * 300), "「うん」") }),
        ),
      ),
    );
    expect(rendered).toContain("四分位を出せん");
  });
});

describe("引数の検証", () => {
  it("綴り間違いのオプション名を落とす（黙って既定のコーパスを測らん）", () => {
    expect(() => parseArgs(["--souce", "model-ab"])).toThrow("知らん引数: --souce");
    expect(() => parseArgs(["--shufles", "3"])).toThrow("知らん引数");
  });

  it("桁の多すぎる --shuffles を落とす（Infinity で無限ループにならん）", () => {
    // parseInt が Infinity を返すと `Infinity < 1` は false なので通ってまい、
    // 帰無分布の for が終わらんくなる
    expect(() => parseArgs(["--shuffles", "9".repeat(400)])).toThrow("--shuffles は");
    expect(() => parseArgs(["--shuffles", "1000"])).toThrow("100 以下");
  });

  it("値の不正も落とす", () => {
    expect(() => parseArgs(["--source", "model_ab"])).toThrow("--source は");
    expect(() => parseArgs(["--shuffles", "0"])).toThrow("--shuffles は");
    expect(() => parseArgs(["--shuffles", "3x"])).toThrow("--shuffles は");
    expect(() => parseArgs(["--source"])).toThrow("値が要る");
  });

  it("正しい指定は通る", () => {
    expect(parseArgs(["--source", "model-ab", "--shuffles", "9"])).toMatchObject({
      source: "model-ab",
      shuffles: 9,
    });
    expect(parseArgs([]).source).toBe("vlong-dogfood");
  });
});

describe("セル内の限界再掲率", () => {
  const withConfig = (arm: string | null, turn: number, chars: number): BenchTurn =>
    turnOf({
      scenario: `${arm ?? "none"}-${chars}/テスト`,
      run: `${arm ?? "none"}-${chars}`,
      turn,
      rawBody: xml("あ".repeat(chars), "「うん」"),
      config:
        arm === null
          ? null
          : {
              mode: "session",
              arm,
              responseLength: "very_long",
              runId: "1",
              expectedTurns: 10,
              lengthDirective: true,
            },
    });

  it("設定の記録が無い run はセルを作らん（台本もキャラもモデルも混ざる）", () => {
    // model-ab は config が丸ごと null。`?` でまとめると台本4本・キャラ3人・
    // 複数モデルが1セルに入って、傾きが何の分か言えんくなる
    const measured = marginalRecycledRate(
      measureAll([300, 600, 900].map((chars) => withConfig(null, 2, chars))),
    );
    expect(measured.cells).toBe(0);
    expect(measured.slope).toBeNull();
  });
});
