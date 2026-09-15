// bench のコーパス読み取り。既に生成済みの応答をファイルから読むだけで、
// LLM も D1 も叩かん。台の状態に依存せず同じ入力を何度でも測り直せるようにする。
//
// 2形式ある。どちらも .work/e2e-results/ 配下で、git 追跡外やが実在する。
//  1. vlong-dogfood/<run>/<char>-<NN>-session-*.txt — 1ターン1ファイル。ヘッダ + 生XML
//     同じ run に summary-session-<arm>-<runId>.json が居り、宣言された設定を持つ
//  2. model-ab-stage{0,1,2}.json — model-ab-test.ts の出力。fullResults[] が会話1本

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { hasReadableResponseContent } from "../../src/lib/quality-guard";
import { parseXmlResponse, stripXmlTags } from "../../src/lib/xml-response-parser";

import type { ScenePhase } from "../../src/lib/scene-phase";

export const SCENE_PHASES: readonly ScenePhase[] = [
  "conversation",
  "intimate",
  "erotic",
  "climax",
  "afterglow",
];

/**
 * run に宣言されとった設定。**測定結果やない。**
 * 群を「その群の median 字数」で切ると循環するので、条件はこっちで切る。
 */
export type RunConfig = {
  mode: string | null;
  arm: string | null;
  /** 宣言された応答長設定（medium / long / very_long など） */
  responseLength: string | null;
  /**
   * その run が**長さの指示をモデルへ送っとった**か。
   * 記録済みのハーネスは必ず送るので、明示的に false と書いてある時だけ false。
   * bench:generate は送らんので false になり、床（＝不足の判定）が付かん。
   */
  lengthDirective: boolean;
  runId: string | null;
  /** その run が回すつもりやったターン数。記録が無ければ null */
  expectedTurns: number | null;
};

export type BenchTurn = {
  /** どのファイル形式から来たか。混ぜて集計する時に母集団を分けるため */
  source: "vlong-dogfood" | "model-ab" | "bench-run";
  /** 条件の識別子。vlong は run ディレクトリ名、model-ab は stage+シナリオ */
  run: string;
  /**
   * **会話1本の識別子。**ターン間の反復判定はこの単位で閉じる。
   * model-ab は scenarioId × model × trial が別会話なので、run では粗すぎる
   * （混ぜると trial2 の turn1 が trial1 の turn7 と反復判定される）。
   */
  scenario: string;
  character: string;
  /** シナリオ内の通し番号。1 始まり。尻すぼみを見るのに使う */
  turn: number;
  /**
   * フェーズ。vlong-dogfood はサーバが選んだ値、bench-run は **generate.ts が
   * ローカルで推定した値**（サーバを通しとらん）。床の判定に使うので、
   * 出所が違うことを忘れたら bench-run の「不足」を読み違える。
   */
  phase: ScenePhase | null;
  model: string | null;
  /** 宣言された設定。記録が無ければ null（推測で埋めん） */
  config: RunConfig | null;
  /** タグを含む生の本文。軸はここから自分で計算する */
  rawBody: string;
  /**
   * 会話が壊れた地点（本文の無い返事・上限切れ）**より後**に記録されたターン。
   * 返事が抜けた文脈で生成されとるので**品質軸では測らん**が、リクエスト自体は
   * 実際に飛んどるので**経路失敗率の分母には残す**。消してもうた時は
   * bench-p1-smoke が 1/5 = 20.0% と出とった（実際は 1/10）。
   */
  afterBrokenContext: boolean;
  /**
   * ハーネスが記録した可視文字数。bench はこれを信用せず、
   * countUiVisibleChars で独立に再計算して突き合わせる（ズレたら記録側のバグ）。
   */
  headerVisibleChars: number | null;
  latencyMs: number | null;
  error: string | null;
  /**
   * 生成が止まった理由（OpenRouter の finish_reason）。`length` は max_tokens の上限に
   * 当たった印で、**モデルの欠陥やのうてこっちの設定**。XML が途中で切れるので、
   * 非XML・層欠け・不足として数える前にこれを見る。記録が無ければ null
   */
  finishReason: string | null;
  /**
   * このターンを引き出した user 発話の文字数。本番の床は相手のターン長で上がる
   * （route-context.ts:4412 energyMultiplier）。記録が無ければ null で、その時は
   * 係数 1.0＝緩い側で測る
   */
  lastUserChars: number | null;
  /** 追跡用。どのファイルの何行目から来たか */
  origin: string;
};

/**
 * ヘッダ1行を key/value へ。`# visibleChars: 253  innerChars: 113  latencyMs: 16311` のように
 * 数値ヘッダだけ複数が同居するので、値が数値の時だけ1行内の追加ペアも拾う。
 * 値に空白を含む可能性があるフィールド（character, error）は行末まで1つの値として取る。
 */
/**
 * ファイル先頭のヘッダに出てよいキー。**ここに無い `# ` 行が来たら本文の始まり。**
 *
 * 「`# ` で始まる行を全部ヘッダ」で切っとった間、`# Response` のような見出しから
 * 始まる壊れた応答は、その行ごと消えてから測られとった。壊れた出力こそ
 * 不良軸がそのまま見なあかんものやし、`# character: ...` を本文に書かれたら
 * 会話の振り分けまで乗っ取られる。
 */
const HEADER_KEYS = new Set([
  "character",
  "turn",
  "intent",
  "servedPhase",
  "servedModel",
  "visibleChars",
  "innerChars",
  "latencyMs",
  "error",
  "finishReason",
  "userChars",
]);

export const headerKeyOf = (line: string): string | null => {
  const parsed = /^# ([a-zA-Z]+): ?/.exec(line);
  return parsed !== null && HEADER_KEYS.has(parsed[1]) ? parsed[1] : null;
};

export const parseHeaderLine = (line: string, into: Map<string, string>): void => {
  const first = /^# ([a-zA-Z]+): ?(.*)$/.exec(line);
  if (!first) return;
  const [, key, rest] = first;
  const numericPairs = [...rest.matchAll(/(?:^|\s)([a-zA-Z]+): ?(-?\d+)(?=\s|$)/g)];
  const leadingNumber = /^(-?\d+)(?:\s|$)/.exec(rest);
  if (leadingNumber) {
    into.set(key, leadingNumber[1]);
    for (const [, extraKey, extraValue] of numericPairs) into.set(extraKey, extraValue);
    return;
  }
  into.set(key, rest.trim());
};

const asPhase = (value: string | undefined): ScenePhase | null =>
  value && (SCENE_PHASES as readonly string[]).includes(value) ? (value as ScenePhase) : null;

const asPositiveInt = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const text = value.trim();
  // **全体が整数の時だけ受ける。**`Number.parseInt` は `# turn: 1.5` を 1、`# turn: 1oops` も
  // 1 として通す。通ると `turn >= 1` の検査もすり抜けて、**別のターンの記録が既存の
  // turn 1 へ重なる**（並べ替えの順序・反復履歴・尻すぼみが全部そこで狂う）
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/** `# error: -` はエラー無しの意味。ハイフンを文字列として拾わんようにする */
const asError = (value: string | undefined): string | null =>
  !value || value === "-" ? null : value;

/** vlong-dogfood の1ファイルを読む。先頭の**既知のキーの** `# ` 行がヘッダ、残りが本文。 */
export const parseVlongTurnFile = (
  content: string,
  origin: string,
  run: string,
  config: RunConfig | null = null,
  source: BenchTurn["source"] = "vlong-dogfood",
): BenchTurn => {
  const lines = content.split("\n");
  const headers = new Map<string, string>();
  // **新しい形式は空行で区切る**（renderTurnFile）。本文の1行目が
  // `# finishReason: length` や `# userChars: 100` の形をしとっても、区切りの前に
  // 無い限りヘッダとして読まん。中身で見分けようとする限り、本文は必ずヘッダを騙せる
  const delimiter = lines.findIndex((line) => line.trim() === "");
  const hasDelimiter =
    delimiter > 0 && lines.slice(0, delimiter).every((line) => headerKeyOf(line) !== null);
  // 区切りの無い古い記録（vlong-dogfood と初期の bench-run）は `# error` で終わる。
  // そこで打ち切らんと、本文の1行目が新しいキーの形をしとった時に、
  // **上限切れや床の判定をその行に乗っ取られる**（本文からもその行が消える）
  const lastLegacyKey = "error";
  let bodyStart = hasDelimiter ? delimiter + 1 : lines.length;
  // **同じキーが2度出たら、そこから本文。**知らんキーで切るだけやと、本文が
  // `# character: 別人` や `# turn: 9` で始まった時に、記録側のヘッダを
  // **上書きして**別の会話・別の位置へ付け替えてまう（その行も本文から消える）。
  // 記録側は各キーを1回しか書かんので、2度目は本文の側や
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (hasDelimiter && index >= delimiter) break;
    const key = headerKeyOf(line);
    if (key === null || seen.has(key)) {
      bodyStart = index;
      break;
    }
    seen.add(key);
    parseHeaderLine(line, headers);
    if (!hasDelimiter && key === lastLegacyKey) {
      bodyStart = index + 1;
      break;
    }
  }
  const character = headers.get("character") ?? "unknown";
  return {
    source,
    run,
    // 1 run 内はキャラごとに1本の会話（vlong-session-dogfood.ts:346 が会話 id を通しで使い回す）
    // source を混ぜる。bench-run と vlong-dogfood は同じ形式なので、`--run` に
    // 既存 run と同じ名前を付けた瞬間、別母集団の会話が1本に混ざる
    scenario: `${source}:${run}/${character}`,
    character,
    // 1始まり。取れんかった時は 0 のまま返して、**読み込み側が捨てる**
    // （ここで投げると、1ファイル壊れただけでコーパス全体が読めんくなる）
    turn: asPositiveInt(headers.get("turn")) ?? 0,
    phase: asPhase(headers.get("servedPhase")),
    model: headers.get("servedModel") ?? null,
    config,
    // **trim せん。**本番は床が1300字未満の時に生の `response.length` で比べる
    // （quality-guard.ts:107）。前後の空白を落とすと、床際の応答が本番では通るのに
    // ここでだけ「不足」になる。空かどうかの判定は測る側が trim して見る
    rawBody: lines.slice(bodyStart).join("\n"),
    afterBrokenContext: false,
    headerVisibleChars: asPositiveInt(headers.get("visibleChars")),
    latencyMs: asPositiveInt(headers.get("latencyMs")),
    error: asError(headers.get("error")),
    finishReason: asError(headers.get("finishReason")),
    lastUserChars: asPositiveInt(headers.get("userChars")),
    origin,
  };
};

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * run ディレクトリの summary-*.json から宣言された設定を取る。
 * 無い run は null のまま返す（ファイル名から推測して埋めたら、それは測定やのうて創作になる）。
 */
export const parseRunSummary = (raw: string): RunConfig | null => {
  const parsed: unknown = JSON.parse(raw);
  // 配列も `typeof === "object"` を通る。受けると arm も responseLength も null の
  // config が出来て、**壊れた run 同士が `?/?` で1つの群にまとまる**。
  // 設定の記録が無い run として扱う方が正しい
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  return {
    mode: asString(record.mode),
    arm: asString(record.arm),
    responseLength: asString(record.responseLength),
    lengthDirective: record.lengthDirective !== false,
    runId:
      asString(record.runId) ?? (typeof record.runId === "number" ? String(record.runId) : null),
    // 0・負数・小数を受けると、`detectTaper` が整数のターン番号をそれと比べる。
    // 負数なら**落ちた run が全部完走に見え**、小数なら完走した run が途中終了に見える。
    // 手で書いた summary や壊れた JSON が混じった時に効く。読めん値は「記録が無い」へ倒す
    expectedTurns:
      typeof record.turns === "number" && Number.isSafeInteger(record.turns) && record.turns >= 1
        ? record.turns
        : null,
  };
};

export const loadRunConfig = (runDir: string): RunConfig | null => {
  if (!existsSync(runDir)) return null;
  const summaryFiles = readdirSync(runDir)
    .filter((name) => name.startsWith("summary-") && name.endsWith(".json"))
    .sort();
  if (summaryFiles.length === 0) return null;
  // 2本以上あったら、どっちの条件のラベルを付けるかを黙って選ばん。
  // ラベルを間違えるのは、設定が無いことより悪い（別条件が1つの群に混ざる）。
  if (summaryFiles.length > 1) {
    throw new Error(
      `summary-*.json が ${summaryFiles.length} 本ある: ${runDir}（どの条件か決められん）`,
    );
  }
  return parseRunSummary(readFileSync(path.join(runDir, summaryFiles[0]), "utf-8"));
};

const isTurnFile = (name: string): boolean => name.endsWith(".txt");

const loadTurnDirectories = (root: string, source: BenchTurn["source"]): BenchTurn[] => {
  const turns: BenchTurn[] = [];
  for (const run of readdirSync(root)) {
    const runDir = path.join(root, run);
    if (!statSync(runDir).isDirectory()) continue;
    const config = loadRunConfig(runDir);
    for (const file of readdirSync(runDir).filter(isTurnFile)) {
      const full = path.join(runDir, file);
      const turn = parseVlongTurnFile(readFileSync(full, "utf-8"), full, run, config, source);
      // **ターン番号の無いファイルは捨てる。**0 のまま入れると、同じ run・同じキャラの
      // そういうファイルが全部「ターン0」に集まって、会話の中で順序が付かんくなる
      // （並びが readdirSync 任せ＝環境で変わる）。黙って捨てんように件数を言う
      if (turn.turn < 1) {
        console.warn(`[warn] # turn が1以上の整数やないので飛ばす: ${full}`);
        continue;
      }
      turns.push(turn);
    }
  }
  return dropDuplicateCoordinates(turns);
};

/**
 * 同じ (会話, ターン) の記録が2本あったら後の方を捨てる。
 *
 * 録り直しの控えが同じディレクトリに在る時や、stage の JSON が同じターンを2回持っとる時に
 * 起きる。残すと `measureScenario` が同じ位置へ並べて、**片方をもう片方の前方履歴**として
 * 反復判定し（turn1 に反復が出る）、報告の分母も倍に膨らむ。
 */
export const dropDuplicateCoordinates = (turns: BenchTurn[]): BenchTurn[] => {
  const seen = new Map<string, string>();
  const kept: BenchTurn[] = [];
  for (const turn of turns) {
    const coordinate = `${turn.scenario}#${turn.turn}`;
    const first = seen.get(coordinate);
    if (first !== undefined) {
      console.warn(
        `[warn] 同じ会話・同じターンの記録が2本あるので後の方を飛ばす: ${turn.origin}` +
          `（先に読んだのは ${first}）`,
      );
      continue;
    }
    seen.set(coordinate, turn.origin);
    kept.push(turn);
  }
  return kept;
};

export const loadVlongDogfood = (root: string): BenchTurn[] =>
  loadTurnDirectories(root, "vlong-dogfood");

/**
 * bench:generate が書いた run。形式は vlong-dogfood と同じやが**母集団が違う**。
 * 本番の platform prefix も品質リトライも通しとらんので、記録済みの29条件と
 * 同じ表へ混ぜたら、また設定と日付が共線した表になる。source を分けて持つ。
 */
export const loadBenchRuns = (root: string): BenchTurn[] => loadTurnDirectories(root, "bench-run");

type ModelAbTurn = {
  turn?: number;
  scenarioId?: string;
  model?: string;
  servedModel?: string;
  phase?: string;
  responseText?: string;
  elapsed?: number;
  infraError?: boolean;
};

/**
 * model-ab の台本 → キャラ。**記録側に無いのでここに写す。**
 * 出所は script/model-ab-test.ts:71-117（SCENARIOS の id / char）。
 * A と D は同じキャラで、B・C は別キャラ。これを "unknown" で潰すと、
 * 帰無分布（bench:analyze）が「同じキャラの別会話」やのうて別キャラの会話を混ぜてまう。
 * 写しが古くならんように corpus.test.ts が元ファイルを読んで確かめる。
 */
export const MODEL_AB_SCENARIO_CHARACTERS: Record<string, string> = {
  A: "鳴海つかさ",
  B: "月島みつき",
  C: "九条あずさ",
  D: "鳴海つかさ",
};

/** fullResults[] の1要素 = 会話1本（台本 × モデル × 試行） */
type ModelAbConversation = {
  scenarioId?: string;
  model?: string;
  trial?: number;
  turns?: unknown;
};

type ModelAbFile = {
  stage?: number;
  fullResults?: unknown;
};

const toBenchTurn = (
  record: ModelAbTurn & Record<string, unknown>,
  run: string,
  scenario: string,
  origin: string,
  character: string,
): BenchTurn => ({
  source: "model-ab",
  run,
  scenario,
  character,
  // ターン番号は1始まり。壊れた記録を 0 で通すと、同じ会話の中で順序が付かん
  // （ファイル側の読み込みと同じ規則。あっちだけ直しとった）
  turn:
    typeof record.turn === "number" && Number.isSafeInteger(record.turn) && record.turn >= 1
      ? record.turn
      : 0,
  phase: asPhase(record.phase),
  model: record.servedModel ?? record.model ?? null,
  config: null,
  rawBody: typeof record.responseText === "string" ? record.responseText : "",
  afterBrokenContext: false,
  headerVisibleChars: null,
  latencyMs: typeof record.elapsed === "number" ? record.elapsed : null,
  error: record.infraError ? "infraError" : null,
  finishReason: null,
  lastUserChars: null,
  origin,
});

/**
 * 会話の識別子を**親から配る。**
 * ターン側の記録に trial が無いので、ターンだけ見て会話を切り分けることはでけへん。
 * 親を無視して集めると stage1:A に 5試行 × 2モデル = 10本の別会話 70ターンが混ざり、
 * ターン番号で並べ替えた結果、別会話の本文と反復判定してまう。
 */
export const collectModelAbConversation = (
  conversation: ModelAbConversation,
  stageRun: string,
  index: number,
  out: BenchTurn[],
): void => {
  const scenarioId = conversation.scenarioId ?? `#${index}`;
  const model = conversation.model ?? "unknown";
  const trial = conversation.trial ?? index;
  const run = `${stageRun}:${scenarioId}`;
  const scenario = `model-ab:${stageRun}:${scenarioId}:${model}:t${trial}`;
  if (!Array.isArray(conversation.turns)) return;
  for (const turn of conversation.turns) {
    if (turn === null || typeof turn !== "object") continue;
    const record = turn as ModelAbTurn & Record<string, unknown>;
    if (typeof record.responseText !== "string") continue;
    out.push(
      toBenchTurn(
        record,
        run,
        scenario,
        scenario,
        MODEL_AB_SCENARIO_CHARACTERS[scenarioId] ?? "unknown",
      ),
    );
  }
};

export const collectModelAbTurns = (node: unknown, stageRun: string, out: BenchTurn[]): void => {
  if (!Array.isArray(node)) return;
  for (const [index, conversation] of node.entries()) {
    if (conversation === null || typeof conversation !== "object") continue;
    collectModelAbConversation(conversation as ModelAbConversation, stageRun, index, out);
  }
};

export const loadModelAbStages = (files: string[]): BenchTurn[] => {
  const turns: BenchTurn[] = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as ModelAbFile;
    const run = `model-ab-stage${parsed.stage ?? path.basename(file)}`;
    collectModelAbTurns(parsed.fullResults, run, turns);
  }
  // **ターン番号の無い記録は捨てる。**ファイル側の読み込みと同じ規則。
  // 0 のまま入れると、同じ会話のそういう記録が全部「ターン0」に集まって順序が付かん
  // （ファイル側だけ直して、こっちを直してへんかった）
  const valid = turns.filter((turn) => turn.turn >= 1);
  if (valid.length !== turns.length) {
    console.warn(`[warn] model-ab に turn が1以上やない記録が ${turns.length - valid.length} 件`);
  }
  // ディレクトリ側と同じ規則（`dropDuplicateCoordinates`）。片側だけ直しとった
  return dropDuplicateCoordinates(valid);
};

/**
 * 経路失敗のプレースホルダは応答やのうて記録。
 * 軸に混ぜると空返信率が二重に数えられるので、error として分離する。
 * 末尾の完全一致にせん（`[API_ERROR:502] upstream` のように後ろへ文字が付いた瞬間、
 * モデルの応答として数えてまうため）。
 */
// model-ab-test.ts は 4 種類書く: API_ERROR / INFRA_ERROR に加えて
// STREAM_ERROR(:306) と FETCH_ERROR(:321)。後ろ2つを落としとると、打ち切られた途中経過が
// モデルの応答として可視文字数・非XML・日本語の軸へ流れ込む。
// （現行コーパスには 0 件やが、次に録った時に黙って混ざる）
const ERROR_PLACEHOLDER = /^\[(?:API_ERROR|INFRA_ERROR|STREAM_ERROR|FETCH_ERROR)[^\]]*\]/;

export const normalizeTurn = (turn: BenchTurn): BenchTurn =>
  ERROR_PLACEHOLDER.test(turn.rawBody.trim())
    ? { ...turn, error: turn.error ?? turn.rawBody.trim(), rawBody: "" }
    : turn;

/**
 * 会話が壊れた地点（本文が1文字も無い／上限で切れた）**より後に本文が返ってきたターン**を捨てる。
 *
 * assistant の返事が抜けた文脈で続きを生成すると、次のリクエストは **user 発話が2つ続く**
 * 形になる。そこから先の本文は「普通の会話の続き」やない。`generate.ts` は同じ理由で
 * 会話をその場で止めるのに、読み込み側が古い記録の続きを測っとった
 * （bench-p1-smoke は turn5 が 429 やのに turn6-10 の本文を採点しとった）。
 *
 * 経路失敗でも、HTTP 200 で本文が空でも同じ扱い。返事が抜けたことに変わりはない。
 *
 * **落ちたターン自体と、その後も落ち続けたターンは残す。**あれは本文が無いので
 * どの品質軸にも入らんし、経路失敗率はインフラの実測としてそのまま要る。
 * 消すと model-ab の 6月が 14.5% → 2.6% に化けて、障害が軽かったことになってまう。
 * 「7ターン揃った会話を途中終了にせん」も、落ちたターンを残すことで保たれる。
 *
 * `normalizeTurn` を通した後に呼ぶ（プレースホルダが rawBody を空にするので）。
 */
/**
 * 画面に出る返事が在るか。**会話を続けてええかの判定**に使う。
 *
 * `hasReadableResponseContent` は外側の `<response>` が無い応答を素テキスト扱いするので、
 * `<action></action>` のような**タグだけの本文**を「中身あり」と答える。不良軸（空返信）は
 * 本番の判定に合わせたままにするが、**会話を続けるかどうかは画面に何か出るかで決める**。
 * 出てへん返事を文脈に積んで次を投げたら、user 発話が2つ続く会話を測ることになる
 */
export const hasVisibleReply = (raw: string): boolean => {
  if (!hasReadableResponseContent(raw)) return false;
  const parsed = parseXmlResponse(raw);
  // **画面に出るのは scene / action / dialogue / narration。`<inner>` は出ん**
  // （countUiVisibleChars と同じ層。quality-guard.ts:90）。`stripXmlTags` は `<inner>` の
  // 本文を残すので、内心だけの応答を「画面に出た」と答えて、次のターンを
  // **ユーザが見てへん返事の続き**として生成・採点してまう
  // パーサが null を返す形（層が空でパースが通らん応答など）でも `<inner>` は落とす。
  // 落とさんと、内心だけの応答が素テキスト扱いで「画面に出た」に化ける
  const withoutInner = raw
    .replace(/<inner\b[^>]*>[\S\s]*?<\/inner\s*>/gi, "")
    .replace(/<inner\b[^>]*>[\S\s]*$/i, "");
  const visible =
    parsed === null
      ? stripXmlTags(withoutInner)
      : [parsed.scene, parsed.action, parsed.dialogue, parsed.narration]
          .filter((section): section is string => typeof section === "string")
          .join("");
  return visible.trim().length > 0;
};

export const markTurnsAfterBrokenContext = (turns: BenchTurn[]): BenchTurn[] => {
  const byScenario = new Map<string, BenchTurn[]>();
  for (const turn of turns) {
    const bucket = byScenario.get(turn.scenario);
    if (bucket) bucket.push(turn);
    else byScenario.set(turn.scenario, [turn]);
  }
  const marked = new Set<BenchTurn>();
  for (const group of byScenario.values()) {
    const ordered = [...group].sort((a, b) => a.turn - b.turn);
    // **本文が無い返事はどれも壊れた文脈の入口。**error の有無で切っとった間、
    // HTTP 200 で本文が空のターン（error は null）の後ろが残っとった。
    // `generate.ts` はその経路でも会話を止める。返事が抜けたことに変わりはない。
    // **上限切れも会話の切れ目。**途中で切れた XML がそのまま次の文脈へ入る。
    // 本文があるので `isEmpty` では拾えん
    // 「返事が無い」の判定は本番の `hasReadableResponseContent` に揃える。
    // 空白だけを見とった間、`<response></response>` のような**画面に何も出せん応答**が
    // 会話の切れ目として拾われんかった（現行コーパスには0件やが、次に録ったら効く）
    const failed = ordered.findIndex(
      (t) => !hasVisibleReply(t.rawBody) || t.finishReason === "length",
    );
    if (failed === -1) continue;
    for (const turn of ordered.slice(failed + 1)) {
      // それ自体が経路失敗のターンには印を付けん。あれは「失敗の後ろ」やのうて**失敗**で、
      // `report.ts:118 hasTransportError` が同じ切り方で品質軸から外し、経路失敗率の
      // 分子に数える。二重に印を付けると「壊れた文脈の後」の件数が障害の件数で膨らむ
      if (turn.error !== null && !hasReadableResponseContent(turn.rawBody)) continue;
      // **本文の有無だけで選り分けん。**error の無い空の返事は、壊れた文脈のまま投げた
      // 結果やのに、印が無いと `summarize` が「モデルが空を返した」不良として数える
      marked.add(turn);
    }
  }
  // **消さずに印を付ける。**消すと、実際に飛んだリクエストが経路失敗率の分母からも
  // 消えて、失敗率が水増しされる（bench-p1-smoke が 1/5 = 20.0% と出とった。実際は 1/10）
  return turns.map((turn) => (marked.has(turn) ? { ...turn, afterBrokenContext: true } : turn));
};
