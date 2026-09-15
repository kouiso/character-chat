// 測定結果の集計。7軸を run / turn / phase 別に並べる。
//
// 過去の測定が崩壊した原因を機構で防ぐ:
//  - すべての率は分子と分母を持つ（`Rate` 型）。「18.6%」だけを持ち回らん
//  - 長さに引きずられる指標を出さん。AI臭は per1000、水増しは distinctRatio（比）
//  - 長さと水増しは同じ行に並べる。長さだけ見て「良くなった」と読めんようにする

import { isRepeatFlagged, REPEAT_SENSITIVITY_SETTINGS, type RepeatSetting } from "./axes";

import type { TurnMeasurement } from "./axes";
import type { ScenePhase } from "../../src/lib/scene-phase";

export type Rate = { hits: number; total: number };

export const rate = (hits: number, total: number): Rate => ({ hits, total });

export const formatRate = ({ hits, total }: Rate): string =>
  total === 0 ? "—" : `${hits}/${total} = ${((100 * hits) / total).toFixed(1)}%`;

/**
 * 中央値。**丸めん。**
 * 偶数個のとき Math.round しとった実装は、0〜1 の比を median で出した瞬間に
 * 0 か 1 へ潰れる（実質比が全条件 1.000、反復被覆率が全条件 0.000 になっとった）。
 * 表示の桁は描画側の fmt が決める。
 */
export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 1 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const medianOf = (values: (number | null)[]): number | null =>
  median(values.filter((value): value is number => value !== null));

export type GroupSummary = {
  key: string;
  turns: number;
  /** 長さ（不足方向のみ判定。値そのものは中央値で並べる） */
  medianVisibleChars: number | null;
  tooShort: Rate;
  /**
   * 水増し。長さと同じ行に出す。1.0 に近いほど再掲が無い。
   * **median だけ見たらあかん。**83.8% のターンがちょうど 1.0 なので、条件別 median は
   * ほぼ全部 1.000 に潰れる（AI臭を median で出して全条件 0.00 になったのと同じ形）。
   * 平均と「再掲が出たターンの率」を併せて持つ。
   */
  medianDistinctRatio: number | null;
  meanDistinctRatio: number | null;
  /** distinctRatio が 1.0 を割ったターンの率 */
  withinTurnRepeat: Rate;
  /**
   * AI臭。median は使えん — 疎な計数なので大半のターンが 0 で、median が常に 0 になる
   * （最初 median で出して全条件 0.00 になり、辞書が死んどるように見えた）。
   * 平均と「1件以上出たターンの率」を併せて持つ。
   */
  meanSlopPer1000: number;
  slopHitRate: Rate;
  /**
   * 経路の失敗（429・502・タイムアウト）。**モデルの振る舞いやない。**
   * 分母は全ターン。以降の不良軸は、この行を除いたターンを分母にする。
   */
  transportError: Rate;
  /** 壊れた文脈の後に記録されたターン数。品質軸の分母には入っとらん */
  afterBrokenContext: number;
  /**
   * max_tokens の上限に当たって切れたターン。**モデルの欠陥やのうてこっちの設定。**
   * XML が途中で切れるので、非XML・層欠け・不足がここに引きずられる
   */
  lengthCapped: Rate;
  /** 不良。分母は「応答が返ってきたターン」 */
  empty: Rate;
  brokenJapanese: Rate;
  nearDuplicate: Rate;
  /** 本番のガードが止めたはずの数。bench の測定軸やない（本番互換の入力で判定した値） */
  repeatProduction: Rate;
  /** bench の測定軸。層ごとに全ブロックを比べる */
  repeatLayerAware: Rate;
  /** 再掲句の被覆率。履歴の本数が増えると単調に上がるので、ターン位置を揃えて読む */
  medianRepeatCoverage: number | null;
  /** 直前1ターンだけを相手にした被覆率。履歴の本数に依存せん */
  medianRepeatCoveragePrev: number | null;
  /** その群で到達した最大ターン。エラーで打ち切られた条件は小さくなる（生存者バイアスの目印） */
  maxTurn: number;
  tagLeak: Rate;
  notXml: Rate;
  /** タグの体はあるのにパースでけへん（開始と終了の食い違い） */
  unparseableXml: Rate;
  missingLayer: Rate;
  /** エスカレーション。感覚チャンネル数の中央値 */
  medianSensoryChannels: number | null;
  /** 記録ヘッダとの食い違い。同一アルゴリズムの写しなので転記ミスしか見つからん */
  headerMismatch: Rate;
  /** パーサ経由と正規表現のみの2経路の食い違い。これが本物の交差検証 */
  crossCheckMismatch: Rate;
};

/**
 * 応答が1文字も出んかった経路の失敗。**不良軸の分母から外すのはこれだけ。**
 *
 * 6月の「空返信 14.5%」は [API_ERROR:502] 等のインフラ障害で、8月の「モデルが空を返した」
 * とは別現象やった。同じ列に置くと、母集団を跨いだ時に改善へ化ける。
 *
 * ただし error が記録されとるだけで外したらあかん。vlong-dogfood の
 * `stream error: upstream_error` 4件は、本文を1234〜1355字**出し切ってから**ストリームが
 * 落ちとる。応答は実在するので、これを捨てると本物のモデル出力が測定から消える
 * （最初その形で実装して median が 892 から 881 へ下がった）。
 */
/**
 * max_tokens に当たって切れたターン。XML が途中で切れるので、非XML・層欠け・不足が
 * ここに引きずられる。**こっちの設定の結果**なので、モデルの不良軸には入れん。
 */
const isLengthCapped = (m: TurnMeasurement): boolean => m.turn.finishReason === "length";

const hasTransportError = (m: TurnMeasurement): boolean => m.turn.error !== null && m.isEmpty;

/** 判定でけたターンだけを分母にした率 */
const judgedRate = (
  measurements: TurnMeasurement[],
  pick: (m: TurnMeasurement) => boolean | null,
): Rate => {
  const judged = measurements.filter((m) => pick(m) !== null);
  return rate(judged.filter((m) => pick(m) === true).length, judged.length);
};

export const summarize = (key: string, group: TurnMeasurement[]): GroupSummary => {
  // **経路失敗率だけは印の付いたターンも分母に入れる。**あれは実際に飛んだ
  // リクエストで、成否も記録されとる。品質軸から外すのと、無かったことにするのは別
  const responded = group.filter((m) => !hasTransportError(m) && !m.turn.afterBrokenContext);
  // 不良軸の分母は「応答が返ってきて、かつ上限で切れてへんターン」。
  // 上限切れを混ぜると、こっちが決めた max_tokens をモデルの欠陥として数えてまう。
  const scored = responded.filter((m) => !isLengthCapped(m));
  const total = scored.length;
  const withHeader = scored.filter((m) => m.visibleCharsHeaderDelta !== null);
  return {
    key,
    turns: total,
    transportError: rate(group.filter(hasTransportError).length, group.length),
    // 壊れた文脈の後に記録されたターン。品質軸の分母には入れてへん
    afterBrokenContext: group.filter((m) => m.turn.afterBrokenContext).length,
    medianVisibleChars: median(scored.map((m) => m.visibleChars)),
    // 床の無い run（長さの指示を送っとらん）は分母からも外す。
    // false 扱いで混ぜると「不足しとらん」の側へ水増しされる
    tooShort: (() => {
      const judged = scored.filter((m) => m.isTooShort !== null);
      return rate(judged.filter((m) => m.isTooShort === true).length, judged.length);
    })(),
    medianDistinctRatio: medianOf(scored.map((m) => m.distinctRatio)),
    // **採点対象の中を見る。**`responded` で判定すると、上限切れしか無い run で
    // `mean([])` を呼んで 0.0000 と印字してまう（＝ターン内再掲が最大、という顔になる）。
    // 同じ行が「採点したターンは0件」と言うとるのに
    meanDistinctRatio: scored.some((m) => m.distinctRatio !== null)
      ? mean(scored.filter((m) => m.distinctRatio !== null).map((m) => m.distinctRatio ?? 0))
      : null,
    withinTurnRepeat: rate(
      scored.filter((m) => m.distinctRatio !== null && m.distinctRatio < 1).length,
      scored.filter((m) => m.distinctRatio !== null).length,
    ),
    meanSlopPer1000: mean(scored.map((m) => m.slopPer1000)),
    slopHitRate: rate(scored.filter((m) => m.slop.total > 0).length, total),
    lengthCapped: rate(responded.filter(isLengthCapped).length, responded.length),
    empty: rate(scored.filter((m) => m.isEmpty).length, total),
    brokenJapanese: rate(scored.filter((m) => m.hasBrokenJapanese).length, total),
    // **測れんかったターンは分母からも外す。**記録に穴が空いた後のターンは前の
    // ターンとの比較が成り立たんので null。false 扱いで混ぜると「反復してへん」側へ水増しする
    nearDuplicate: judgedRate(scored, (m) => m.isNearDuplicate),
    repeatProduction: judgedRate(scored, (m) => m.repeatProduction),
    repeatLayerAware: judgedRate(scored, (m) => m.repeatLayerAware),
    medianRepeatCoverage: medianOf(scored.map((m) => m.repeatCoverage)),
    medianRepeatCoveragePrev: medianOf(scored.map((m) => m.repeatCoveragePrev)),
    maxTurn: responded.reduce((max, m) => Math.max(max, m.turn.turn), 0),
    tagLeak: rate(scored.filter((m) => m.hasTagLeak).length, total),
    notXml: rate(scored.filter((m) => m.isNotXml).length, total),
    unparseableXml: rate(scored.filter((m) => m.hasUnparseableXml).length, total),
    missingLayer: rate(scored.filter((m) => m.missingLayer).length, total),
    medianSensoryChannels: median(scored.map((m) => m.sensoryChannels)),
    headerMismatch: rate(
      withHeader.filter((m) => m.visibleCharsHeaderDelta !== 0).length,
      withHeader.length,
    ),
    crossCheckMismatch: rate(
      scored.filter((m) => m.visibleCharsCrossCheckDelta !== 0).length,
      total,
    ),
  };
};

export type GroupBy =
  | "run"
  | "turn"
  | "phase"
  | "model"
  | "source"
  | "scenario"
  | "config"
  | "arm"
  | "responseLength";

/** 設定が記録されてへん run を「不明」で1つに束ねると、別条件が混ざる。run 名を残す */
const configKeyOf = (measurement: TurnMeasurement): string => {
  const config = measurement.turn.config;
  if (!config) return `(設定の記録なし) ${measurement.turn.run}`;
  return `${config.arm ?? "?"} / ${config.responseLength ?? "?"}`;
};

const groupKeyOf = (measurement: TurnMeasurement, by: GroupBy): string => {
  switch (by) {
    case "run":
      return measurement.turn.run;
    case "turn":
      return String(measurement.turn.turn).padStart(2, "0");
    case "phase":
      return measurement.turn.phase ?? "(none)";
    case "model":
      return measurement.turn.model ?? "(none)";
    case "source":
      return measurement.turn.source;
    case "scenario":
      return measurement.turn.scenario;
    case "config":
      return configKeyOf(measurement);
    case "arm":
      return measurement.turn.config?.arm ?? `(記録なし) ${measurement.turn.run}`;
    case "responseLength":
      // **設定の記録が無い run と、「長さを指定してへん」と記録した run は別。**
      // 後者（bench:generate）まで run ごとの名前にしとった間、同じ条件を何本積んでも
      // この群では1本ずつに割れて、まとめて読めんかった
      if (measurement.turn.config === null) return `(記録なし) ${measurement.turn.run}`;
      return measurement.turn.config.responseLength ?? "(長さの指示なし)";
  }
};

export const groupSummaries = (measurements: TurnMeasurement[], by: GroupBy): GroupSummary[] => {
  const groups = new Map<string, TurnMeasurement[]>();
  for (const measurement of measurements) {
    const key = groupKeyOf(measurement, by);
    const bucket = groups.get(key);
    if (bucket) bucket.push(measurement);
    else groups.set(key, [measurement]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => summarize(key, group));
};

const pad = (value: string, width: number): string => value.padStart(width);
/**
 * 桁を落とす時に「4.5 が 5」へ化けるのを防ぐ。
 * median を丸めん実装に直した意味が、描画で消えとった（感覚チャンネルの median 4.5 が
 * 表では 5 と出て、「典型ターンが5ch」と読めてまう）。整数やない値は小数を残す。
 */
const fmt = (value: number | null, digits = 0): string => {
  if (value === null) return "—";
  if (digits === 0 && !Number.isInteger(value)) return value.toFixed(1);
  return value.toFixed(digits);
};

/**
 * 長さ と 水増し を必ず隣に置く表。長さだけ伸びて水増しも伸びた条件が
 * 一目で分かるようにするのが目的（局長の「文字数が上がったら合格ってこと？」への答え）。
 */
export const renderLengthVsSlopTable = (summaries: GroupSummary[]): string => {
  const header =
    `| 条件 | n | 最終turn | median字数 | 不足 | 実質比(平均) | ターン内再掲 | 反復被覆率 ` +
    `| 反復被覆率(直前のみ) | AI臭/1000字(平均) | AI臭ターン率 | 感覚ch |`;
  const divider = `|---|---:|---:|---:|---|---:|---|---:|---:|---:|---|---:|`;
  const rows = summaries.map(
    (s) =>
      `| ${s.key} | ${s.turns} | ${s.maxTurn} | ${fmt(s.medianVisibleChars)} | ${formatRate(s.tooShort)} ` +
      `| ${fmt(s.meanDistinctRatio, 4)} | ${formatRate(s.withinTurnRepeat)} ` +
      `| ${fmt(s.medianRepeatCoverage, 3)} ` +
      `| ${fmt(s.medianRepeatCoveragePrev, 3)} ` +
      `| ${s.turns === 0 ? "—" : s.meanSlopPer1000.toFixed(2)} ` +
      `| ${formatRate(s.slopHitRate)} | ${fmt(s.medianSensoryChannels)} |`,
  );
  return [header, divider, ...rows].join("\n");
};

/**
 * 不良の表。「タグ漏れ」列は出さん — stripXmlTags の後を見とるので実質発火せん
 * （1,042ターンで 0/1042 やった）。代わりに、パーサ経由と正規表現の2経路が食い違う
 * 「タグ構造破損」を出す。こっちは 5/1042 拾えて、うち3件は他のどの軸も捕まえてへん。
 */
export const renderDefectTable = (summaries: GroupSummary[]): string => {
  const header =
    `| 条件 | n | 経路失敗 | 上限切れ | 空返信 | 日本語壊れ | 近似重複 | 句反復(層別) | 句反復(本番互換) ` +
    `| タグ構造破損 | 非XML | パース不能 | 層欠け |`;
  const divider = `|---|---:|---|---|---|---|---|---|---|---|---|---|---|`;
  const rows = summaries.map(
    (s) =>
      `| ${s.key} | ${s.turns} | ${formatRate(s.transportError)} | ${formatRate(s.lengthCapped)} ` +
      `| ${formatRate(s.empty)} ` +
      `| ${formatRate(s.brokenJapanese)} ` +
      `| ${formatRate(s.nearDuplicate)} | ${formatRate(s.repeatLayerAware)} ` +
      `| ${formatRate(s.repeatProduction)} ` +
      `| ${formatRate(s.crossCheckMismatch)} | ${formatRate(s.notXml)} ` +
      `| ${formatRate(s.unparseableXml)} | ${formatRate(s.missingLayer)} |`,
  );
  // **外した分を表の下に書く。**`n` と経路失敗の分母だけ見た読み手には、
  // 10ターン投げて n=4・経路失敗 1/10 の run で**残り5ターンがどこへ行ったか分からん**
  // （意図した除外なのか、記録が欠けとるのか区別でけへん）
  const excluded = summaries.filter((s) => s.afterBrokenContext > 0);
  const note =
    excluded.length === 0
      ? []
      : [
          "",
          `※ 壊れた文脈の後に記録されたターンを品質軸の分母から外しとる` +
            `（経路失敗の分母には残す）: ` +
            excluded.map((s) => `${s.key} ${s.afterBrokenContext}ターン`).join(" / "),
        ];
  return [header, divider, ...rows, ...note].join("\n");
};

/**
 * 閾値の感度。句長と一致数を動かして、結論が閾値の選び方に依存してへんことを見る。
 * 1つの閾値だけで「これが最大の不良」と言うたら、それは測定やのうて主張になる。
 */
export const repeatSensitivity = (
  all: TurnMeasurement[],
): { setting: RepeatSetting; flagged: Rate }[] => {
  // 不良表と分母を揃える。応答が返らんかったターンを混ぜると、同じ文書の中で
  // 「57.1%（482）」と「57.4%（476）」が併存する
  // 不良表と同じ分母にする。上限切れを混ぜると、感度表だけ別の母集団になって
  // 隣の表と数字が合わん
  // **壊れた文脈の後も同じく外す。**`summarize` だけ外しとった間、bench-p1-smoke で
  // 不良表が4ターン・感度表が9ターンと、隣り合う表が別の母集団を測っとった
  const measurements = all.filter(
    (m) =>
      !hasTransportError(m) &&
      !isLengthCapped(m) &&
      !m.turn.afterBrokenContext &&
      // 記録の穴の後は前のターンと比べられんので、感度表の分母からも外す
      m.repeatLayerAware !== null,
  );
  return REPEAT_SENSITIVITY_SETTINGS.map((setting) => ({
    setting,
    flagged: rate(
      measurements.filter((m) =>
        isRepeatFlagged(
          {
            repeatedPhraseLengths: m.repeatedPhraseLengths,
            comparedChars: m.repeatComparedChars,
            repeatedChars: 0,
          },
          setting,
        ),
      ).length,
      measurements.length,
    ),
  }));
};

export const renderRepeatSensitivityTable = (measurements: TurnMeasurement[]): string => {
  const rows = repeatSensitivity(measurements).map(
    ({ setting, flagged }) =>
      `| ${setting.minPhraseLength}字以上 | ${setting.minPhrases}句 | ${formatRate(flagged)} |`,
  );
  return [`| 句長 | 一致数 | 発火 |`, `|---|---:|---|`, ...rows].join("\n");
};

/**
 * source を跨いだ集計を既定で禁止する。
 *
 * model-ab (2026-06-17・7ターン・台本A〜D) と vlong-dogfood (8月・10ターン・別台本・
 * 別キャラ) は日付と設定と長さが完全に共線で、1つの表に並べた時点でどの差も
 * 「何が効いたか」を言えん。注記では足りんかったので、既定で並べさせん。
 */
export const partitionForReport = (
  measurements: TurnMeasurement[],
  compareSources: boolean,
): { key: string; measurements: TurnMeasurement[] }[] => {
  const sources = [...new Set(measurements.map((m) => m.turn.source))].sort();
  if (compareSources || sources.length <= 1) {
    return [
      {
        key: sources.length > 1 ? `全体（source 跨ぎ）` : (sources[0] ?? "全体"),
        measurements,
      },
    ];
  }
  return sources.map((source) => ({
    key: source,
    measurements: measurements.filter((m) => m.turn.source === source),
  }));
};

export const SOURCE_CONFOUND_WARNING =
  "⚠ source を跨いで並べとる。model-ab (2026-06-17) と vlong-dogfood (2026-08) は " +
  "日付・台本・キャラ・応答長設定が全部違い、交絡から出られん。差を改善と読んだらあかん。" +
  "空返信も 6月は [API_ERROR] 由来で、モデルが空を返した8月とは別現象。";

/**
 * 尻すぼみ検査。
 *
 * 最初の定義（最終ターン < turn1）は**尻すぼみを1件も測っとらんかった。**
 * turn1 は 42/52 の会話でその会話の最短ターンなので、まず発火せん。実際に拾えた
 * 5件は全部、経路失敗で会話が途中終了した会話やった（vlong-session-dogfood.ts:460 が
 * `if (record.error || !record.text) break;` で打ち切る）。つまり出とった数字は
 * 「尻すぼみ率」やのうて「途中終了率」やった。
 *
 * 定義を2つ直す:
 *  1. **途中終了した会話は分母から外す。**最後まで行った会話だけが尻すぼみを語れる
 *  2. **ピークと比べる。**最終2ターンの平均が、それ以前のピークの 80% を割ったら尻すぼみ
 */
export type TaperResult = {
  scenario: string;
  firstTurn: number;
  lastTurn: number;
  firstChars: number;
  lastChars: number;
  /** それ以前のターンで一番長かった可視文字数 */
  peakChars: number;
  /** 最終2ターンの平均 */
  tailMeanChars: number;
  /** 同じ run の他の会話より手前で終わっとる。尻すぼみの判定から外す */
  truncated: boolean;
  /** 有効な応答が3ターン揃っとって、ピーク比を出せた */
  taperComputable: boolean;
  /** 最終2ターンの平均がピークの 80% を割った */
  tapered: boolean;
};

const TAPER_THRESHOLD = 0.8;

export const detectTaper = (measurements: TurnMeasurement[]): TaperResult[] => {
  const byScenario = new Map<string, TurnMeasurement[]>();
  for (const measurement of measurements) {
    const key = measurement.turn.scenario;
    const bucket = byScenario.get(key);
    if (bucket) bucket.push(measurement);
    else byScenario.set(key, [measurement]);
  }
  // 「途中終了」は**期待された最終ターンに届いてへん**ことで決める。
  //
  // 「エラーを含む会話」で切っとった時は、エラーが出ても最後まで回る母集団（model-ab）で
  // 7ターン揃った会話まで途中終了にしてもうとった（stage0 で 13本）。
  //
  // 期待値は run が宣言しとるターン数（summary の `turns`）を最優先で使う。
  // 記録が無い run は **source 単位**で一番進んだ会話に落とす。run 単位にすると、
  // その run の会話が全部途中で切れとる時に「一番マシな切れ方」が期待値になって見逃す
  // （実例: baseline は Downer が turn4、Sakura が turn8 で切れとって、run 単位やと
  // Sakura が完走扱いになる。台本は10ターン）。
  // 宣言を先に見るのは、`bench:generate --turns 3` の条件を「途中終了」にせんため。
  const expectedLastTurn = new Map<string, number>();
  for (const measurement of measurements) {
    const source = measurement.turn.source;
    expectedLastTurn.set(
      source,
      Math.max(expectedLastTurn.get(source) ?? 0, measurement.turn.turn),
    );
  }
  const results: TaperResult[] = [];
  for (const [scenario, all] of byScenario) {
    // 壊れた文脈の後のターンは会話の続きやない。会話の終わりもピーク比も、
    // そこまでで決める（経路失敗率だけが summarize であれを分母に入れる）
    const group = all.filter((m) => !m.turn.afterBrokenContext);
    if (group.length === 0) continue;
    // **途中終了かどうかを先に決める。**3ターン揃うことを入口の条件にしとった間は、
    // turn1・turn2 で落ちた会話が途中終了の**分子からも分母からも消えとった**。
    // bench:generate は経路失敗・空応答・上限切れでその場で会話を止めるので、
    // turn1 で落ちた10ターンの run が「途中終了 0%」の報告になる
    const reached = Math.max(...group.map((m) => m.turn.turn));
    const started = Math.min(...group.map((m) => m.turn.turn));
    const usable = [...group]
      .sort((a, b) => a.turn.turn - b.turn.turn)
      .filter((m) => !m.isEmpty && m.turn.finishReason !== "length");
    const source = group[0].turn.source;
    const expected =
      group[0].turn.config?.expectedTurns ?? expectedLastTurn.get(source) ?? reached;
    // **最後まで行った＝宣言された最終ターンに「使える応答」が在る**こと。
    // 記録の在る一番後ろのターン番号で見とった間、最終ターンが経路失敗や上限切れでも
    // 完走扱いになって、その手前の応答を末尾として尻すぼみを判定しとった
    // （model-ab には最終ターンが使えん会話が13本ある）
    // **記録ごと抜けたターンが在る会話も途中終了。**一番後ろの番号だけ見とった間、
    // 途中のターンが記録から落ちて（読み込み側が壊れた記録を飛ばす経路がある）
    // 最終ターンだけ在る会話が完走に見えて、穴の空いた会話でピーク比を出しとった。
    // **記録が在って失敗しとるターンは穴やない**（エラーが出ても最後まで回った会話は
    // 完走。model-ab stage0 の13本がこれ）ので、判定は「記録の在る位置」で見る
    const recordedPositions = new Set(group.map((m) => m.turn.turn));
    // **`expected` の大きさで配列を作らん。**壊れた summary の `turns` はここまで
    // そのまま届くので、`4294967296` を渡されたら配列長エラーで採点ごと落ちるし、
    // 少し小さい値でもメモリを食い潰す。位置は一意なので、1〜expected に入っとる
    // 個数を数えれば穴の有無は分かる
    let withinExpected = 0;
    for (const position of recordedPositions) {
      if (position >= 1 && position <= expected) withinExpected += 1;
    }
    const missingPosition = withinExpected < expected;
    const truncated = (usable.at(-1)?.turn.turn ?? 0) < expected || missingPosition;

    // 経路失敗のターンは可視0字なので、混ぜるとピークも末尾も引き下げる。
    // stage0 には全7ターンがプレースホルダの会話が11本あって、それが
    // 「ピーク0字・尻すぼみやない」として分母を薄めとった
    const ordered = [...group]
      .sort((a, b) => a.turn.turn - b.turn.turn)
      // 注: 上の `usable` と同じ条件。あっちは完走判定、こっちはピーク比の材料
      // **経路失敗は「error があり、かつ本文が1文字も無い」。**`error !== null` だけで切ると、
      // 本文を1234〜1355字**出し切ってから** stream error で落ちた4ターンまで捨てる。
      // `summarize` はそれを測っとるのに、こっちだけ捨てて手前のターンを会話の末尾として
      // 報告しとった。`!isEmpty` がその条件の残り半分をそのまま満たす
      // （HTTP 200 で本文が空のターンも同じ式で落ちる。末尾に0字が残ると
      // 「完走して尻すぼみした」に化ける）。
      // 上限切れも外す。error は null のままなので別に見る必要がある
      .filter((m) => !m.isEmpty && m.turn.finishReason !== "length");
    // ピーク比には「ピークになれるターン」と「末尾2ターン」が要る。
    // 足りん会話は尻すぼみを**測れん**（測って「尻すぼみやない」にしたらあかん）
    const taperComputable = ordered.length >= 3;
    const last = ordered.at(-1);
    const tail = ordered.slice(-2);
    const tailMeanChars = taperComputable ? mean(tail.map((m) => m.visibleChars)) : 0;
    const peakChars = taperComputable
      ? Math.max(...ordered.slice(0, -2).map((m) => m.visibleChars), 0)
      : 0;
    results.push({
      scenario,
      firstTurn: ordered[0]?.turn.turn ?? started,
      lastTurn: last?.turn.turn ?? reached,
      firstChars: ordered[0]?.visibleChars ?? 0,
      lastChars: last?.visibleChars ?? 0,
      peakChars,
      tailMeanChars,
      truncated,
      taperComputable,
      tapered:
        taperComputable &&
        !truncated &&
        peakChars > 0 &&
        tailMeanChars < peakChars * TAPER_THRESHOLD,
    });
  }
  return results.sort((a, b) => a.scenario.localeCompare(b.scenario));
};

export const renderTaperSummary = (results: TaperResult[]): string => {
  const completed = results.filter((r) => !r.truncated);
  // 完走しとっても有効な応答が3ターン無い会話は分母から外す。
  // 「測れんかった」を「尻すぼみやない」に混ぜると、率が実際より低う出る
  const measurable = completed.filter((r) => r.taperComputable);
  const unmeasurable = completed.length - measurable.length;
  const tapered = measurable.filter((r) => r.tapered).length;
  const lines = [
    `途中終了（宣言されたターン数に届いてへん）: ${formatRate(rate(results.length - completed.length, results.length))}` +
      `  ← 尻すぼみの分母から外す`,
    `尻すぼみ（最終2ターンの平均がピークの ${TAPER_THRESHOLD * 100}% 未満）: ` +
      `${formatRate(rate(tapered, measurable.length))}` +
      (unmeasurable > 0
        ? `（完走しとるが有効な応答が3ターン無い ${unmeasurable} 本は測れんので分母から外した）`
        : ""),
    "",
    `| 会話 | turn範囲 | turn1字数 | ピーク | 最終2平均 | 尻すぼみ |`,
    `|---|---|---:|---:|---:|:---:|`,
    ...results.map(
      (r) =>
        `| ${r.scenario} | ${r.firstTurn}→${r.lastTurn} | ${r.firstChars} | ${r.peakChars} ` +
        `| ${Math.round(r.tailMeanChars)} | ${
          r.truncated ? "（途中終了）" : !r.taperComputable ? "（測れん）" : r.tapered ? "はい" : "—"
        } |`,
    ),
  ];
  return lines.join("\n");
};

/**
 * 数字の土台の点検。ここが 0 でないと以降の数字が信用でけへん。
 *
 * 2種類あって、強さが違う。混ぜて報告したらあかん:
 *  A. ヘッダとの一致 — **弱い。** ヘッダを書いた script/verify/vlong-session-dogfood.ts:141 の
 *     countVisible は countUiVisibleChars と同一アルゴリズムの写しなので、一致しても
 *     「同じ式が同じ答えを出した」だけ。転記ミスと破損しか見つからん。
 *  B. 2経路の一致 — **強い。** パーサ経由(countUiVisibleChars)と正規表現のみ
 *     (countVisibleCharsIndependently)が一致するかどうか。実装のバグを見つける。
 */
export const renderIntegrityCheck = (measurements: TurnMeasurement[]): string => {
  // **本文が無いターンと上限切れは点検の母集団から外す。**本文が1文字も無ければ
  // どっちの数え方でも 0 になるので、点検を通った顔で分母だけ膨らませる
  // （model-ab は 0/560 と出とったが、実際に応答があるのは 479）。
  // 経路失敗だけやのうて `isEmpty` で切る。HTTP 200 で本文が空のターンは
  // error が null のままなので、経路失敗の条件では拾えん（generate.ts はそこで会話を止める）。
  // max_tokens で途中で切れた応答は XML が閉じてへんので、
  // パーサ経由と正規表現のみで答えが食い違うのが**正常**。混ぜると、こっちが決めた
  // トークン上限を「実装のバグで以降の数字が信用でけへん」と報告してまう。
  // 採点の表からは既に外しとるのに、点検だけ母集団が違うとった
  const uncapped = measurements.filter(
    (m) => !isLengthCapped(m) && !m.isEmpty && !m.turn.afterBrokenContext,
  );
  const withHeader = uncapped.filter((m) => m.visibleCharsHeaderDelta !== null);
  const headerMismatched = withHeader.filter((m) => m.visibleCharsHeaderDelta !== 0);
  const crossMismatched = uncapped.filter((m) => m.visibleCharsCrossCheckDelta !== 0);
  const lines = [
    `B. 交差検証（パーサ経由 vs 正規表現のみ・別実装）: ` +
      `不一致 ${formatRate(rate(crossMismatched.length, uncapped.length))}`,
  ];
  for (const m of crossMismatched.slice(0, 10)) {
    lines.push(
      `  - ${m.turn.origin}: パーサ ${m.visibleChars} / 正規表現 ${m.visibleCharsIndependent} ` +
        `(差 ${m.visibleCharsCrossCheckDelta})`,
    );
  }
  if (crossMismatched.length > 10) lines.push(`  - ほか ${crossMismatched.length - 10} 件`);
  lines.push(
    "",
    `A. 記録ヘッダとの一致（同一アルゴリズムの写しなので転記ミス検出のみ・実装の正しさは見てへん）: ` +
      `ズレ ${formatRate(rate(headerMismatched.length, withHeader.length))}`,
  );
  for (const m of headerMismatched.slice(0, 10)) {
    lines.push(
      `  - ${m.turn.origin}: 記録 ${m.turn.headerVisibleChars} / 再計算 ${m.visibleChars} ` +
        `(差 ${m.visibleCharsHeaderDelta})`,
    );
  }
  if (headerMismatched.length > 10) lines.push(`  - ほか ${headerMismatched.length - 10} 件`);
  return lines.join("\n");
};

export type JsonlRecord = {
  origin: string;
  source: string;
  run: string;
  scenario: string;
  arm: string | null;
  responseLength: string | null;
  character: string;
  turn: number;
  phase: ScenePhase | null;
  model: string | null;
  visibleChars: number;
  headerDelta: number | null;
  crossCheckDelta: number;
  /** 上限切れの印。これが無いと、切れた XML をモデルの欠陥として読んでまう */
  finishReason: string | null;
  lengthCapped: boolean;
  afterBrokenContext: boolean;
  isEmpty: boolean;
  isTooShort: boolean | null;
  hasBrokenJapanese: boolean;
  distinctRatio: number | null;
  isNearDuplicate: boolean | null;
  repeatProduction: boolean | null;
  repeatLayerAware: boolean | null;
  repeatCoverage: number | null;
  repeatCoveragePrev: number | null;
  slopTotal: number;
  slopPer1000: number;
  slopTemplatePhrase: number;
  slopFillerProp: number;
  slopAbstractEscape: number;
  slopStockMoan: number;
  sensoryChannels: number;
  hasTagLeak: boolean;
  isNotXml: boolean;
  hasUnparseableXml: boolean;
  missingLayer: boolean;
  error: string | null;
};

/** 1ターン1行。あとで別の切り口で集計し直せるように、判定済みの値だけを残す */
export const toJsonlRecord = (m: TurnMeasurement): JsonlRecord => ({
  origin: m.turn.origin,
  source: m.turn.source,
  run: m.turn.run,
  scenario: m.turn.scenario,
  arm: m.turn.config?.arm ?? null,
  responseLength: m.turn.config?.responseLength ?? null,
  character: m.turn.character,
  turn: m.turn.turn,
  phase: m.turn.phase,
  model: m.turn.model,
  visibleChars: m.visibleChars,
  headerDelta: m.visibleCharsHeaderDelta,
  crossCheckDelta: m.visibleCharsCrossCheckDelta,
  finishReason: m.turn.finishReason,
  lengthCapped: m.turn.finishReason === "length",
  // CLI が品質軸から外す条件を、外へ出す側にも書く。書かんかったら
  // 読み手が同じ母集団を作り直せん（除外の規則を勘で再発見することになる）
  afterBrokenContext: m.turn.afterBrokenContext,
  isEmpty: m.isEmpty,
  isTooShort: m.isTooShort,
  hasBrokenJapanese: m.hasBrokenJapanese,
  distinctRatio: m.distinctRatio,
  isNearDuplicate: m.isNearDuplicate,
  repeatProduction: m.repeatProduction,
  repeatLayerAware: m.repeatLayerAware,
  repeatCoverage: m.repeatCoverage,
  repeatCoveragePrev: m.repeatCoveragePrev,
  slopTotal: m.slop.total,
  slopPer1000: m.slopPer1000,
  slopTemplatePhrase: m.slop.template_phrase,
  slopFillerProp: m.slop.filler_prop,
  slopAbstractEscape: m.slop.abstract_escape,
  slopStockMoan: m.slop.stock_moan,
  sensoryChannels: m.sensoryChannels,
  hasTagLeak: m.hasTagLeak,
  isNotXml: m.isNotXml,
  hasUnparseableXml: m.hasUnparseableXml,
  missingLayer: m.missingLayer,
  error: m.turn.error,
});

export { pad };
