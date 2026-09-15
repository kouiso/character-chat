// Phase 1 解析（plan v21 work item 2b）。腕ごとの transcript .txt を読み直して
// 反復率を計る読み取り専用スクリプト。engine/judge のランタイム経路は触らない。
//
// 計測は3種:
// - cross-turn ngram ratio: ngramCheck(本文, [参照窓]) の ratio。
//   参照窓は先行ターンの pre-extend 本文を連結した末尾 K 字（mechanicsPhase 別）。
//   K は --calibrate に渡した A1 run 群の per-phase preExtendVisibleChars 中央値を
//   run ごとに取って小さい方（min(A1run1, A1run2)）。A3 を参照しない（循環防止）。
// - 感度チェックの turn-fixed 窓: 直前ターンの pre-extend 本文だけを参照にする
//   （仮説寄りに偏ることが分かっとるので、こっちでだけ差が出ても証拠にせん）。
// - intra-turn: countRepeatedNgrams(collapse(本文)) — Set 化で消えるターン内反復。
//
// 本文も参照窓も <inner> ブロックごと剥がしてから collapse する。collapse はタグだけ
// 剥がして inner 本文を残すので、そのままだと可視字数（action+dialogue のみ）と
// 反復の母集団がズレる（v21 round 6 の指摘）。
//
// 使い方:
//   tsx src/repetition-rate.ts --dirs <dir1,dir2,...> --calibrate <dir1,dir2>
//   出力は 1 ターン 1 行の JSONL + 最終行に K テーブル。

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { collapse, countRepeatedNgrams, nearDuplicateCheck, ngramCheck } from "@v2/judge";

type TurnFile = {
  file: string;
  character: string;
  turn: number;
  intent: string;
  servedPhase: string | null;
  mechanicsPhase: string | null;
  visibleChars: number | null;
  innerChars: number | null;
  preExtendVisibleChars: number | null;
  preExtendBodyChars: number | null;
  extended: number;
  dropped: number;
  error: string | null;
  body: string;
  // record.text の先頭 preExtendBodyChars 字（<response>\n 込み）= extend 前の受理本文。
  preExtendBody: string;
};

const HEADER_FIELD = /^# ([A-Za-z]+): (.*)$/;
const CHARS_LINE = /^# visibleChars: (\d+) {2}innerChars: (\d+) {2}latencyMs: (.*)$/;
const PRE_EXTEND_LINE = /^# preExtendVisibleChars: (\S+) {2}preExtendBodyChars: (\d+)$/;
const BODY_MARKER = "# --- ここから本文 ---";

const numOrNull = (value: string | undefined): number | null => {
  if (value === undefined || value === "-") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// ヘッダ行（# key: value）を BODY_MARKER まで読んで fields と本文開始行を返す。
const parseHeader = (lines: string[]): { fields: Map<string, string>; bodyStart: number } => {
  const fields = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    if (line === BODY_MARKER) return { fields, bodyStart: index + 1 };
    const charsMatch = line.match(CHARS_LINE);
    if (charsMatch) {
      fields.set("visibleChars", charsMatch[1]);
      fields.set("innerChars", charsMatch[2]);
      continue;
    }
    const preExtendMatch = line.match(PRE_EXTEND_LINE);
    if (preExtendMatch) {
      fields.set("preExtendVisibleChars", preExtendMatch[1]);
      fields.set("preExtendBodyChars", preExtendMatch[2]);
      continue;
    }
    const field = line.match(HEADER_FIELD);
    if (field) fields.set(field[1], field[2]);
  }
  return { fields, bodyStart: -1 };
};

type Header = Map<string, string>;

const fieldNum = (fields: Header, key: string): number | null => numOrNull(fields.get(key));
const fieldInt = (fields: Header, key: string): number => Number(fields.get(key) ?? "0") || 0;
const fieldOr = (fields: Header, key: string, fallback: string): string =>
  fields.get(key) ?? fallback;
// "-" はヘッダ側の null 表記（mechanicsPhase / error が使う）。
const fieldNullable = (fields: Header, key: string): string | null => {
  const value = fields.get(key);
  return value === undefined || value === "-" ? null : value;
};

const readTurnFile = (path: string): TurnFile => {
  const lines = readFileSync(path, "utf8").split("\n");
  const { fields, bodyStart } = parseHeader(lines);
  if (bodyStart === -1) throw new Error(`本文マーカーが無い: ${path}`);
  const body = lines.slice(bodyStart).join("\n");
  const preExtendBodyChars = fieldNum(fields, "preExtendBodyChars");
  return {
    file: basename(path),
    character: fieldOr(fields, "character", "?"),
    turn: fieldInt(fields, "turn"),
    intent: fieldOr(fields, "intent", "?"),
    servedPhase: fieldNullable(fields, "servedPhase"),
    mechanicsPhase: fieldNullable(fields, "mechanicsPhase"),
    visibleChars: fieldNum(fields, "visibleChars"),
    innerChars: fieldNum(fields, "innerChars"),
    preExtendVisibleChars: fieldNum(fields, "preExtendVisibleChars"),
    preExtendBodyChars,
    extended: fieldInt(fields, "extended"),
    dropped: fieldInt(fields, "dropped"),
    error: fieldNullable(fields, "error"),
    body,
    // 切り出せんターン（フィールド欠損）は全文を pre-extend と見なさず空にする。
    // 欠損を黙って全文扱いにすると参照窓へ extend 文が混ざって境目が壊れる。
    preExtendBody: preExtendBodyChars === null ? "" : body.slice(0, preExtendBodyChars),
  };
};

// ディレクトリ名 `YYYY-MM-DD-arm-run-runId` から腕を取る（日付が 3 セグメント食うので 4 番目）。
const armOf = (dir: string): string => basename(dir).split("-")[3] ?? basename(dir);

// ヘッダに # extended が無い古い transcript は summary-*.json から補完する。
// （extended をヘッダへ出すのは後付け。run 単位の summary が正本なので齟齬はない。）
const readSummaryExtended = (dir: string): Map<string, number> => {
  const summary = readdirSync(dir).find(
    (name) => name.startsWith("summary-") && name.endsWith(".json"),
  );
  const map = new Map<string, number>();
  if (!summary) return map;
  const rows = JSON.parse(readFileSync(join(dir, summary), "utf8")).results as {
    character: string;
    turn: number;
    extended: number;
  }[];
  for (const row of rows) map.set(`${row.character}:${row.turn}`, row.extended);
  return map;
};

const readDir = (dir: string): TurnFile[] => {
  const summaryExtended = readSummaryExtended(dir);
  return readdirSync(dir)
    .filter((name) => /^[A-Za-z]+-\d+-.*\.txt$/.test(name))
    .map((name) => {
      const turn = readTurnFile(join(dir, name));
      // ヘッダが無い run（extended 0 かつ summary に値あり）だけ補完する。
      if (turn.extended === 0 && summaryExtended.get(`${turn.character}:${turn.turn}`)) {
        turn.extended = summaryExtended.get(`${turn.character}:${turn.turn}`)!;
      }
      return turn;
    })
    .sort((a, b) => a.character.localeCompare(b.character) || a.turn - b.turn);
};

const INNER_BLOCK = /<inner>[\S\s]*?<\/inner>/g;
const stripInner = (text: string): string => text.replace(INNER_BLOCK, "");

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// A1 の calibrate dir 群から per-phase K を作る。phase ごとに run 単位で中央値を取り、
// その最小値を K にする。K の無い phase のターンには全体最小値を使う。
export const calibrateK = (dirs: string[]): Map<string, number> => {
  // phase → run 名 → 値配列
  const byPhase = new Map<string, Map<string, number[]>>();
  for (const dir of dirs) {
    for (const turn of readDir(dir)) {
      const phase = turn.mechanicsPhase ?? turn.servedPhase ?? "?";
      if (turn.preExtendVisibleChars === null) continue;
      if (!byPhase.has(phase)) byPhase.set(phase, new Map());
      const runs = byPhase.get(phase)!;
      if (!runs.has(dir)) runs.set(dir, []);
      runs.get(dir)!.push(turn.preExtendVisibleChars);
    }
  }
  const table = new Map<string, number>();
  for (const [phase, runs] of byPhase) {
    const medians = [...runs.values()]
      .map((values) => median(values))
      .filter((value): value is number => value !== null);
    if (medians.length > 0) table.set(phase, Math.min(...medians));
  }
  return table;
};

const lastChars = (text: string, count: number): string => (count <= 0 ? "" : text.slice(-count));

// 1 ターン分の計測。窓が空（先行ターン無し・pre-extend 切り出せず）は null で出す。
const analyzeTurn = (
  arm: string,
  turn: TurnFile,
  previous: TurnFile[],
  k: number,
): Record<string, unknown> => {
  const preExtendCorpus = previous.map((candidate) => candidate.preExtendBody).join("\n");
  const windowK = stripInner(lastChars(preExtendCorpus, k));
  const windowFixed = stripInner(previous.at(-1)?.preExtendBody ?? "");
  const text = stripInner(turn.body);
  const ratioFor = (window: string): number | null =>
    window.length === 0 ? null : ngramCheck(text, [window]).ratio;
  const matchesFor = (window: string): number | null =>
    window.length === 0 ? null : nearDuplicateCheck(text, [window]).matches.length;
  const per100 = (matches: number | null): number | null =>
    matches === null || !turn.visibleChars ? null : (matches / turn.visibleChars) * 100;
  return {
    arm,
    character: turn.character,
    turn: turn.turn,
    mechanicsPhase: turn.mechanicsPhase,
    servedPhase: turn.servedPhase,
    intent: turn.intent,
    visibleChars: turn.visibleChars,
    innerChars: turn.innerChars,
    preExtendVisibleChars: turn.preExtendVisibleChars,
    extended: turn.extended,
    dropped: turn.dropped,
    error: turn.error,
    k,
    ratioK: ratioFor(windowK),
    ratioFixed: ratioFor(windowFixed),
    intraTurnRepeats: countRepeatedNgrams(collapse(text)),
    nearDupPer100K: per100(matchesFor(windowK)),
    nearDupPer100Fixed: per100(matchesFor(windowFixed)),
    file: turn.file,
  };
};

export const analyzeDir = (dir: string, kTable: Map<string, number>): Record<string, unknown>[] => {
  const arm = armOf(dir);
  const kFallback = Math.min(...kTable.values());
  const turns = readDir(dir);
  return turns.map((turn, index) => {
    // 同じ会話（= 同じキャラ）の先行ターンだけを参照にする。turn=1 には先行が無い。
    const previous = turns
      .slice(0, index)
      .filter((candidate) => candidate.character === turn.character);
    const phase = turn.mechanicsPhase ?? turn.servedPhase ?? "?";
    return analyzeTurn(arm, turn, previous, kTable.get(phase) ?? kFallback);
  });
};

const main = (): void => {
  const args = process.argv.slice(2);
  const readList = (name: string): string[] => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1].split(",").filter(Boolean) : [];
  };
  const dirs = readList("--dirs");
  const calibrateDirs = readList("--calibrate");
  if (dirs.length === 0) throw new Error("--dirs <dir,dir,...> が要る");
  if (calibrateDirs.length === 0) throw new Error("--calibrate <A1dir,A1dir> が要る（K の決め手）");
  const kTable = calibrateK(calibrateDirs);
  for (const dir of dirs) {
    for (const row of analyzeDir(dir, kTable)) {
      console.log(JSON.stringify(row));
    }
  }
  console.log(JSON.stringify({ kTable: Object.fromEntries(kTable), calibrateDirs }));
};

if (import.meta.url === `file://${process.argv[1]}`) main();
