#!/usr/bin/env tsx
// bench の統計。**doc に載せる数字は全部ここから出す。**
//
// 集計表（cli.ts）で出せん3つを持つ:
//  1. 帰無分布 — 前方履歴を「同じキャラの別会話」の同じ位置までに差し替えて反復を測り直す。
//     定型句やキャラ由来の言い回しなら、別会話相手でも同じくらい当たるはず
//  2. 長さ四分位 — 反復が露出量の副産物やないかを見る
//  3. 限界再掲率 — 判定対象文字を1字増やした時に増える再掲文字（セル内の最小二乗）
//
// doc へ手計算の数字を書いたら、コーパスや軸が動いた時に黙って古くなる。
// 「再導出できる」と書く以上、その手順もリポジトリに置く。
//
// 3本とも「セルが揃わんかったら数字を出さん」で書いとる。それらしい表を出すより、
// 出せんことを言う方が正確やから。使い方は doc/bench-measurement.md に置く。
import { existsSync } from "node:fs";
import path from "node:path";

import { isRepeatFlagged, measureAll, measureRepeat, type TurnMeasurement } from "./axes";
import {
  hasVisibleReply,
  loadBenchRuns,
  loadModelAbStages,
  loadVlongDogfood,
  markTurnsAfterBrokenContext,
  normalizeTurn,
  type BenchTurn,
} from "./corpus";
import { formatRate, median, rate } from "./report";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const RESULTS = path.join(PROJECT_ROOT, ".work", "e2e-results");
const DEFAULT_BENCH_RUNS_DIR = path.join(RESULTS, "bench-runs");
const STRICT_SETTING = { minPhraseLength: 16, minPhrases: 2 } as const;

type Source = BenchTurn["source"];

const loadSource = (source: Source, benchRunsDir: string): BenchTurn[] => {
  if (source === "vlong-dogfood") {
    const dir = path.join(RESULTS, "vlong-dogfood");
    return existsSync(dir) ? loadVlongDogfood(dir) : [];
  }
  if (source === "bench-run") {
    // --out で別の場所へ書いた run も測れるようにする。既定だけ読むと、
    // 頼まれた run やのうてリポジトリに入っとる古い smoke run を分析してまう
    return existsSync(benchRunsDir) ? loadBenchRuns(benchRunsDir) : [];
  }
  const files = [0, 1, 2]
    .map((stage) => path.join(RESULTS, `model-ab-stage${stage}.json`))
    .filter((file) => existsSync(file));
  return files.length > 0 ? loadModelAbStages(files) : [];
};

const byScenario = (turns: BenchTurn[]): Map<string, BenchTurn[]> => {
  const map = new Map<string, BenchTurn[]>();
  for (const turn of turns) {
    const bucket = map.get(turn.scenario);
    if (bucket) bucket.push(turn);
    else map.set(turn.scenario, [turn]);
  }
  for (const group of map.values()) group.sort((a, b) => a.turn - b.turn);
  return map;
};

/**
 * 集計側（report.ts の summarize）と同じ母集団にする。
 * 「error があるターンを全部落とす」やと、本文を1.4k字出し切ってから
 * ストリームが落ちた4ターンまで消えて、分母が 480 やのうて 476 になる。
 * 落とすのは**応答が1文字も無い**経路失敗だけ。
 */
const measurable = (turn: BenchTurn): boolean =>
  turn.rawBody.trim().length > 0 && turn.finishReason !== "length" && !turn.afterBrokenContext;

type RepeatStats = {
  turns: number;
  flagged: number;
  strict: number;
  medianCoverage: number;
  /** 帰無側で「差し替える相手が居らん」ターン。分母に混ぜたら 0% が水増しになる */
  skipped: number;
};

const summarizeRepeat = (
  scenarios: Map<string, BenchTurn[]>,
  historyOf: (scenario: string, index: number) => string[] | null,
): RepeatStats => {
  const coverages: number[] = [];
  let turns = 0;
  let flagged = 0;
  let strict = 0;
  let skipped = 0;
  for (const [scenario, group] of scenarios) {
    // **記録に穴が空いた後は測らん**（`measureScenario` と同じ規則）。
    // turn2 が落ちた会話で turn3 を turn1 と比べると、間に挟まった知らん本文のぶん
    // 反復も被覆率も低い側へ偏る。1ターン目が落ちとる会話も同じ
    const positions = group.map((t) => t.turn);
    const firstGap = positions.findIndex(
      (position, index) => position !== (index === 0 ? 1 : positions[index - 1] + 1),
    );
    for (const [index, turn] of group.entries()) {
      if (!measurable(turn)) continue;
      if (firstGap !== -1 && index >= firstGap) continue;
      const history = historyOf(scenario, index);
      // 差し替える相手が居らんターンは測らん。空の履歴で測ると必ず不一致になり、
      // 「帰無は 0%」が対照の結果やのうて**対照が無かった**ことの表示になる
      if (history === null) {
        skipped += 1;
        continue;
      }
      // **axes と同じ規則。**画面に出た前のターンが1つも無いターン（1ターン目や、
      // 前が全部空やった時）は「反復してへん」やのうて「測れてへん」
      if (!history.some(hasVisibleReply)) continue;
      const measured = measureRepeat(turn.rawBody, history);
      if (measured.comparedChars === 0) continue;
      turns += 1;
      coverages.push(measured.repeatedChars / measured.comparedChars);
      if (isRepeatFlagged(measured)) flagged += 1;
      if (isRepeatFlagged(measured, STRICT_SETTING)) strict += 1;
    }
  }
  return { turns, flagged, strict, medianCoverage: median(coverages) ?? 0, skipped };
};

/** 同じキャラの別会話を1本選ぶ。seed で選び方を変えて平均する */
export const donorFor = (
  scenarios: [string, BenchTurn[]][],
  scenario: string,
  character: string,
  /** 受け手のターン番号。ドナーの履歴は**この番号より前のターン**から取る */
  beforeTurn: number,
  seed: number,
  /**
   * 受け手が実際に持っとる前方履歴の**本数**。
   * ターン番号で揃えるだけやと、受け手の prefix に経路失敗が混じっとる時に
   * 帰無側だけ履歴が厚うなって、帰無率が実際より高う出る
   */
  needed: number,
): BenchTurn[] => {
  // **キャラだけやのうて、モデルと宣言設定も揃える。**語彙と長さの基準が変わる物を
  // 跨いでドナーにすると、帰無側だけ「そもそも似てへん本文」になって、
  // 実測との差が実際より大きく出る（こっちの主張に都合よく転ぶ側の偏り）。
  // arm までは揃えられん（同じキャラ・同じ arm の別会話は 52本中2本しか無い）。
  // arm と日付が残る交絡やと doc に書く
  const self = scenarios.find(([key]) => key === scenario)?.[1]?.[0];
  const selfTurns = scenarios.find(([key]) => key === scenario)?.[1] ?? [];
  // **前方履歴の phase の並びも揃える。**同じキャラ・同じモデル・同じ宣言設定でも、
  // 同じターン位置で erotic に入っとる会話と conversation のままの会話がある
  // （baseline/Downer と phase3/Downer が実際にそう）。conversation の履歴を
  // erotic の履歴の代わりに渡すと、**そもそも語彙が重ならん**ので帰無側が下振れして、
  // 「実測 − 帰無」が実際より大きく出る（こっちの主張に都合よく転ぶ側の偏り）
  // 比べるのは**実際に渡す履歴の分だけ**（needed 本）。index 本で比べると、受け手の
  // 履歴が薄い時にドナー側だけ長い並びを求めることになって、選べんくなる
  // **配列の位置やのうてターン番号で切る。**ドナーに穴が空いとると、位置で切った時に
  // **受け手と同じ位置か後ろのターン**が「前方履歴」として入って、帰無率が高う出る
  const beforeOf = (group: BenchTurn[]): BenchTurn[] =>
    group.filter((t) => t.turn < beforeTurn);
  // **phase だけやのうてモデルの並びも揃える。**会話の途中でモデルが変わる run が
  // 実際にある（phase17 と phase19 は Qwen と DeepSeek が混ざる）。先頭のターンだけ
  // 見とった間、DeepSeek の履歴が Qwen の履歴に差し替わっとった
  const historyShapeOf = (group: BenchTurn[]): string =>
    beforeOf(group)
      .filter(measurable)
      .slice(0, needed)
      .map((t) => `${t.phase ?? "?"}|${t.model ?? "?"}`)
      .join(",");
  const selfShape = historyShapeOf(selfTurns);
  const others = scenarios.filter(
    ([key, group]) =>
      key !== scenario &&
      group[0]?.character === character &&
      group[0]?.model === self?.model &&
      (group[0]?.config?.responseLength ?? null) === (self?.config?.responseLength ?? null) &&
      historyShapeOf(group) === selfShape &&
      // **同じ位置まで到達した会話に限る。** 途中終了した会話をドナーにすると、
      // 本物より短い履歴しか渡さんので帰無側の一致機会が減り、「実測との差」が
      // 実際より大きく出る（こっちの主張に都合よく転ぶ側の偏り）
      // **prefix を切ってから数える。**先に filter すると列が詰まって、
      // 受け手より後ろのターンが「前方履歴」に混ざる（帰無側が高く出る）
      beforeOf(group).filter(measurable).length >= needed,
  );
  if (others.length === 0) return [];
  // **並び順を固定してから選ぶ。**候補の順序は readdirSync 由来なので、
  // 別のファイルシステムへ置き直すと同じコーパス・同じ seed で別のドナーが当たる。
  // 「ファイルから何度でも再導出できる」が売りの台で、それは通らん
  const ordered = [...others].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const chosen = ordered[Math.abs(seed + scenario.length) % ordered.length][1];
  // **渡す履歴そのものを返す。**切り出しを呼び出し側に置いとった間、そこだけ
  // 配列の位置で切っとって、穴の在るドナーから受け手と同じ位置・後ろのターンが
  // 「前方履歴」として混ざっとった
  return beforeOf(chosen).filter(measurable).slice(0, needed);
};

export const renderNullModel = (turns: BenchTurn[], shuffles: number): string => {
  const scenarios = byScenario(turns);
  const entries = [...scenarios.entries()];
  const historyWithin = (scenario: string, index: number): string[] =>
    (scenarios.get(scenario) ?? [])
      .slice(0, index)
      .filter(measurable)
      .map((t) => t.rawBody);
  const real = summarizeRepeat(scenarios, historyWithin);
  // **対照が取れた分だけの実測も出す。**帰無側はドナーの居らんターンを分母から外すのに、
  // 実測だけ全ターンで出しとった。外れたターンの反復率が違えば、その差のぶんだけ
  // 「実測 − 帰無」が偏る（比べとる母集団が違う）
  const matchedReal = summarizeRepeat(scenarios, (scenario, index) => {
    const character = scenarios.get(scenario)?.[0]?.character ?? "";
    const needed = historyWithin(scenario, index).length;
    // ドナーが居るかどうかは seed に依らん（seed は候補の中からどれを引くかだけ決める）
    const recipientTurn = scenarios.get(scenario)?.[index]?.turn ?? index + 1;
    return donorFor(entries, scenario, character, recipientTurn, 0, needed).length === 0
      ? null
      : historyWithin(scenario, index);
  });

  let flagged = 0;
  let strict = 0;
  let coverage = 0;
  let nullTurns = 0;
  for (let seed = 0; seed < shuffles; seed += 1) {
    const shuffled = summarizeRepeat(scenarios, (scenario, index) => {
      const character = scenarios.get(scenario)?.[0]?.character ?? "";
      // 本物と同じ位置の履歴を渡す。**切ってから落とす**（順序が逆やと詰まる）。
      // ドナーが1本も無い時は null（測らん）。空配列を返すと「帰無 0%」が
      // 対照の結果に見えてまう
      // 受け手と**同じ本数**の履歴を渡す。本数が違うと、比べとるのが
      // 「別会話かどうか」やのうて「履歴が何本あるか」になる
      const needed = historyWithin(scenario, index).length;
      // **seed に定数倍を掛けん。**`seed * 7 + 1` やと、ドナーが7本の時
      // `(seed * 7 + 1 + len) % 7` が seed によらず一定になって、`--shuffles 5` が
      // 同じ対照を5回引くだけになる（14本やと2種類しか出ん）。
      // 「5回平均」と書いとるのに平均になっとらん
      const recipientTurn = scenarios.get(scenario)?.[index]?.turn ?? index + 1;
      const donor = donorFor(entries, scenario, character, recipientTurn, seed, needed);
      // ドナーが居らんターンは、履歴が要らん1ターン目でも測らん。
      // `needed === 0` を空履歴で通しとった間、キャラに会話が1本しか無いコーパスで
      // 「帰無 0.0%（1ターン）」が出とった。**対照を取っとらんのに数字が出る**
      if (donor.length === 0) return null;
      return donor.map((t) => t.rawBody);
    });
    flagged += shuffled.flagged / Math.max(1, shuffled.turns);
    strict += shuffled.strict / Math.max(1, shuffled.turns);
    coverage += shuffled.medianCoverage;
    nullTurns = shuffled.turns;
  }
  const pct = (value: number): string => `${(100 * value).toFixed(1)}%`;
  if (nullTurns === 0) {
    // **「ドナーが居らん」と「判定でける本文が無い」を分ける。**turns === 0 だけで
    // 前者と決めつけとった間、短い掛け合いばかりのコーパスで「別会話を集めろ」と
    // 言うてまう（実際に足りてへんのは8字以上の句の方）
    return matchedReal.turns === 0 && real.turns > 0
      ? `**帰無分布を作れんかった。** 同じキャラ・同じ設定の別会話が1本も無いので、` +
          `差し替える相手が居らん（実測は ${formatRate(rate(real.flagged, real.turns))}）。`
      : `**帰無分布を作れんかった。** 判定でけるターンが無い` +
          `（8字以上の句が在って、前のターンと比べられるターンが1つも無い）。`;
  }
  return [
    `| | 実測（全ターン） | 実測（対照が取れた分） | 帰無（別会話・${shuffles}回平均） |`,
    `|---|---|---|---|`,
    `| 句反復（8字2句） | ${formatRate(rate(real.flagged, real.turns))} ` +
      `| ${formatRate(rate(matchedReal.flagged, matchedReal.turns))} | ${pct(flagged / shuffles)} |`,
    `| 句反復（16字2句） | ${formatRate(rate(real.strict, real.turns))} ` +
      `| ${formatRate(rate(matchedReal.strict, matchedReal.turns))} | ${pct(strict / shuffles)} |`,
    `| median 被覆率 | ${real.medianCoverage.toFixed(4)} ` +
      `| ${matchedReal.medianCoverage.toFixed(4)} | ${(coverage / shuffles).toFixed(4)} |`,
    "",
    // **外した数は「測れとったのにドナーが居らんかった」ターンだけを言う。**
    // `skipped` は履歴の無い1ターン目も数えるので、実測の分母から落ちた数と合わん
    // （99 と言うて実際は 47 やった）
    `帰無と比べるのは**真ん中の列**（同じ母集団）。帰無側で測れたのは ${nullTurns} ターン` +
      (real.turns > matchedReal.turns
        ? `（差し替える相手が居らん ${real.turns - matchedReal.turns} ターンは両方の分母から外した）`
        : ""),
  ].join("\n");
};

const QUARTILE_MIN_PER_STRATUM = 8;

/** 帰無分布を回す上限。これ以上はドナーを舐め尽くしとるし、時間だけ食う */
const MAX_SHUFFLES = 100;

/**
 * 層のキー。**長さ以外で長さと反復の両方を動かす物を全部入れる。**
 * キャラと phase を入れてへんかった間、Downer の erotic turn1 と Sakura の
 * conversation turn1 が同じ層に入っとった。キャラシートも台本も phase ごとの指示も
 * 長さと反復を動かすので、その差が「長さの効果」として出てまう
 */
const stratumKeyOf = (measurement: TurnMeasurement): string =>
  [
    `turn=${measurement.turn.turn}`,
    `character=${measurement.turn.character}`,
    `phase=${measurement.turn.phase ?? "(記録なし)"}`,
    `arm=${measurement.turn.config?.arm ?? "(記録なし)"}`,
    `len=${measurement.turn.config?.responseLength ?? "(記録なし)"}`,
    `model=${measurement.turn.model}`,
  ].join(" / ");

/**
 * 長さ四分位。**長さ以外を揃えた層の中で**長さで切って、順位で束ねる。
 *
 * 一括で切っとった間は、長さとターン位置が交絡しとった。被覆率は前方履歴すべてとの
 * 比較なので後ろのターンほど当たりやすく、しかも後ろのターンほど長い。
 * ターン位置だけ揃えても足りん: arm・宣言設定・モデル・日付も長さと反復の両方を動かす。
 *
 * 揃える物を増やすとセルが小さなる。**足りんかったら表を出さん**。
 * 「長さの効果」を名乗れるだけの層が無いことを言う方が、それらしい表より正確。
 */
export const renderQuartiles = (measurements: TurnMeasurement[]): string => {
  const usable = measurements.filter(
    // 経路失敗は「error があり、かつ本文が空」。本文を出し切ってから落ちたターンは
    // summarize も尻すぼみも測っとるので、ここだけ別の母集団にせん
    (m) =>
      !m.isEmpty &&
      m.turn.finishReason !== "length" &&
      m.visibleChars > 0 &&
      m.repeatCoverage !== null &&
      // **設定の記録が無い run は層を作れん。**`(記録なし)` で埋めると、
      // model-ab のように config が丸ごと無いコーパスでは stage も台本もキャラも
      // 混ざったまま「モデルとターンが同じ」だけで1つの層になる。
      // 限界再掲率と同じ規則（あっちだけ直して、こっちを直してへんかった）
      m.turn.config !== null &&
      !m.turn.afterBrokenContext,
  );
  // 「測れたのが0件」と「設定の記録が無いから層を作れん」は理由が違う。
  // 混ぜて報告すると、コーパスが空なんか設定が無いんか読み手に分からん
  const configless = measurements.filter(
    (m) => !m.isEmpty && m.turn.finishReason !== "length" && m.turn.config === null,
  ).length;
  const byStratum = new Map<string, TurnMeasurement[]>();
  for (const measurement of usable) {
    const key = stratumKeyOf(measurement);
    const list = byStratum.get(key) ?? [];
    list.push(measurement);
    byStratum.set(key, list);
  }

  const ranked: TurnMeasurement[][] = [[], [], [], []];
  const usedStrata: string[] = [];
  let droppedSmall = 0;
  let droppedTied = 0;
  for (const [key, group] of [...byStratum.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // 4未満やと境界が潰れて Q4 に全部入る（「最長の四分位」という嘘のラベルが付く）
    if (group.length < QUARTILE_MIN_PER_STRATUM) {
      droppedSmall += group.length;
      continue;
    }
    const sorted = [...group].sort(
      (a, b) =>
        a.visibleChars - b.visibleChars ||
        a.turn.scenario.localeCompare(b.turn.scenario) ||
        a.turn.origin.localeCompare(b.turn.origin),
    );
    // **同じ字数を別の四分位へ割らん。**割ると、四分位の差が長さやのうて
    // 並び順で決まる（全部同じ字数でも「順序のついた4つの箱」が出てまう）
    const byLength: TurnMeasurement[][] = [];
    for (const measurement of sorted) {
      const tail = byLength.at(-1);
      if (tail && tail[0].visibleChars === measurement.visibleChars) tail.push(measurement);
      else byLength.push([measurement]);
    }
    if (byLength.length < 4) {
      droppedTied += group.length;
      continue;
    }
    // 同着の塊を割らんまま置くと、箱が空くことがある
    // （字数 [1,1,1,1,1,2,3,4] は Q1・Q3・Q4・Q4 に落ちて Q2 が空になる）。
    // 空の箱に「median 0」を印字したら、四分位を名乗れん
    const assigned: TurnMeasurement[][] = [[], [], [], []];
    let placed = 0;
    for (const bucket of byLength) {
      const index = Math.min(3, Math.floor((4 * placed) / sorted.length));
      assigned[index].push(...bucket);
      placed += bucket.length;
    }
    if (assigned.some((bin) => bin.length === 0)) {
      droppedTied += group.length;
      continue;
    }
    usedStrata.push(key);
    for (const [index, bin] of assigned.entries()) ranked[index].push(...bin);
  }

  if (usedStrata.length === 0) {
    return (
      `**四分位を出せん。**長さ以外（ターン位置・キャラ・phase・arm・宣言設定・モデル）を揃えると、` +
      `${QUARTILE_MIN_PER_STRATUM} 件以上かつ字数が4通り以上ある層が1つも無い` +
      `（件数が足りん ${droppedSmall} ターン、字数が揃いすぎ ${droppedTied} ターン、` +
      `層を作れるのは ${usable.length} ターン` +
      (configless > 0 ? `。設定の記録が無くて層を作れんターンが ${configless} 件` : "") +
      `）。\n\n` +
      `**この記録から「長いほど反復する」は言えん。**ターン位置だけ揃えた表なら出せるが、` +
      `arm ごとのプロンプト差と日付が長さと共線なので、差が長さの分やと言えん。`
    );
  }

  const rows = ranked.map((part, index) => {
    const flagged = part.filter((m) => m.repeatLayerAware === true).length;
    const medianChars = median(part.map((m) => m.visibleChars)) ?? 0;
    return (
      `| Q${index + 1} | ${medianChars.toFixed(0)} | ${part.length} ` +
      `| ${formatRate(rate(flagged, part.length))} ` +
      `| ${(median(part.map((m) => m.repeatCoverage ?? 0)) ?? 0).toFixed(3)} |`
    );
  });

  return [
    `長さ以外を揃えた層の中で四分位へ切って、同じ順位どうしを束ねた` +
      `（束ねた層 ${usedStrata.length} 個。件数が足りん ${droppedSmall} ターンと` +
      `字数が揃いすぎの ${droppedTied} ターンは外した）。\n`,
    `| 四分位 | median可視文字数 | n | 句反復(層別) | median被覆率 |`,
    `|---|---:|---:|---|---:|`,
    ...rows,
  ].join("\n");
};

/**
 * 限界再掲率。**セル（同じ宣言設定 × 同じターン位置）の中**で、判定対象文字が1字増えた時に
 * 再掲文字が何字増えるかを最小二乗で出す。プールしたまま回帰すると、ターン位置と
 * 前方の蓄積量が入り込む。
 */
export const marginalRecycledRate = (
  measurements: TurnMeasurement[],
): { slope: number | null; cells: number; constantCells: number } => {
  const cells = new Map<string, TurnMeasurement[]>();
  for (const m of measurements) {
    // **四分位と同じ母集団で測る。**`error !== null` で切ると、本文を出し切ってから
    // 落ちたターンだけ落として、上限で切れた部分応答は入れてまう（逆の取り方）
    if (m.isEmpty || m.turn.finishReason === "length" || m.turn.afterBrokenContext) continue;
    if (m.repeatCoverage === null || m.repeatComparedChars === 0) continue;
    // **四分位と同じ層の切り方**。arm も宣言設定もモデルも長さと反復の両方を動かす。
    // 記録が無い run（model-ab は config が丸ごと null）を `?` でまとめると、
    // 台本4本・キャラ3人・複数モデルが1セルに入って、傾きが何の分か言えんくなる
    if (m.turn.config === null) continue;
    const key = stratumKeyOf(m);
    const bucket = cells.get(key);
    if (bucket) bucket.push(m);
    else cells.set(key, [m]);
  }
  let numerator = 0;
  let denominator = 0;
  let used = 0;
  let constantCells = 0;
  for (const group of cells.values()) {
    if (group.length < 3) continue;
    const xs = group.map((m) => m.repeatComparedChars);
    const ys = group.map((m) => (m.repeatCoverage ?? 0) * m.repeatComparedChars);
    const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
    const varianceX = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
    // **セル内で長さが動いてへんセルは数に入れん。**傾きへ1文字も寄与せんのに
    // 「N セルで推定した」と書いたら、実際より多くのセルが支えとるように読める。
    // 逆に全セルが定数やった時は「3本以上のセルが在るのに推定でけへん」やのうて、
    // **セル内で長さが動いてへん**と言わなあかん
    if (varianceX === 0) {
      constantCells += 1;
      continue;
    }
    used += 1;
    for (const [index, x] of xs.entries()) {
      numerator += (x - meanX) * (ys[index] - meanY);
      denominator += (x - meanX) ** 2;
    }
  }
  // セルが1つも残らんかったら「0」やのうて「推定でけへん」。
  // 0 を返すと「伸ばしても再掲は増えん」という別の主張に化ける
  if (used === 0 || denominator === 0) return { slope: null, cells: used, constantCells };
  return { slope: numerator / denominator, cells: used, constantCells };
};

export type AnalyzeOptions = {
  source: Source;
  shuffles: number;
  benchRunsDir: string;
};

const SOURCES: Source[] = ["vlong-dogfood", "model-ab", "bench-run"];

/**
 * 知らん引数は落とす。値だけ検証しとった間は `--souce model-ab` のような
 * **綴り間違いが素通り**して、既定の vlong-dogfood の統計が「頼んだとおり」の顔で出とった。
 * cli.ts の parseArgs と同じ形（switch の default で投げる）。
 */
export const parseArgs = (argv: string[]): AnalyzeOptions => {
  const options: AnalyzeOptions = {
    source: "vlong-dogfood",
    shuffles: 5,
    benchRunsDir: DEFAULT_BENCH_RUNS_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} に値が要る`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--source": {
        const value = next();
        if (!(SOURCES as string[]).includes(value)) {
          throw new Error(`--source は ${SOURCES.join(" / ")} のどれか（受け取った値: ${value}）`);
        }
        options.source = value as Source;
        break;
      }
      case "--shuffles": {
        const value = next();
        // 引数の全体が数値であることを見る。NaN のまま回すと帰無分布が全部 NaN で出る。
        // **上限も要る。**桁が多いと parseInt が Infinity を返し、`Infinity < 1` は
        // false なので通ってまい、`for (seed = 0; seed < shuffles)` が終わらんくなる
        const parsed = Number.parseInt(value, 10);
        if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed < 1) {
          throw new Error(`--shuffles は1以上の整数（受け取った値: ${value}）`);
        }
        if (parsed > MAX_SHUFFLES) {
          throw new Error(`--shuffles は ${MAX_SHUFFLES} 以下（受け取った値: ${value}）`);
        }
        options.shuffles = parsed;
        break;
      }
      case "--bench-runs":
        options.benchRunsDir = path.resolve(next());
        break;
      default:
        throw new Error(`知らん引数: ${arg}`);
    }
  }
  return options;
};

const main = (): void => {
  let options: AnalyzeOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }
  const { source, shuffles, benchRunsDir } = options;

  const turns = markTurnsAfterBrokenContext(loadSource(source, benchRunsDir).map(normalizeTurn));
  if (turns.length === 0) {
    console.error(`${source} のコーパスが空`);
    process.exit(1);
  }
  const measurements = measureAll(turns);

  console.log(`# bench:analyze — ${source}（${turns.length} ターン）\n`);
  console.log(`## 1. 反復は測定の artifact やないか（帰無分布）\n`);
  console.log(`前方履歴を、同じキャラの**別会話**の同じ位置までに差し替えて測り直す。\n`);
  console.log(`${renderNullModel(turns, shuffles)}\n`);
  console.log(`## 2. 反復は露出の副産物やないか（長さ四分位）\n`);
  console.log(`${renderQuartiles(measurements)}\n`);
  const marginal = marginalRecycledRate(measurements);
  console.log(`## 3. 伸ばした分のどれだけが再掲か（セル内の限界再掲率）\n`);
  console.log(
    marginal.slope === null
      ? `**推定でけへん。** ターン位置 × キャラ × phase × arm × 宣言設定 × モデルで切ると、` +
          `セル内で長さが動いとるセルが ${marginal.cells} 個しかない` +
          `（3ターン以上あるのに長さが全部同じセルが ${marginal.constantCells} 個。` +
          `設定の記録が無い run はセルを作れんので外す）。` +
          `混ぜて出した数字は、長さやのうて arm ごとのプロンプト差や日付を測っとる\n`
      : `判定対象文字を1字増やした時に増える再掲文字: **${marginal.slope.toFixed(3)} 字**` +
          `（ターン位置 × キャラ × phase × arm × 宣言設定 × モデルで切った ${marginal.cells} セル内で推定）\n`,
  );
};

// import しただけでコーパスを読んで標準出力へ吐かんように、直接起動した時だけ走らせる
if (process.argv[1] !== undefined && process.argv[1].endsWith("analyze.ts")) main();
