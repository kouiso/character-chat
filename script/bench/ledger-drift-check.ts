// RIT-120: 長い一晩の run で「台帳（場所・時刻・服）が本文と食い違う」件数を数える
// 読み取り専用スクリプト。台帳は script-run が run ごとに ledger.jsonl へ吐く。
//
// 食い違いの定義（語彙ベースの目検用スクリーナ。意味判定ではない）:
//   - location: 台帳の location が無いのに本文の場所語が変わった、
//     または台帳の場所語と別の場所語が本文に出た
//   - time: 台帳の時刻語と別の時刻語が本文に出た
//   - clothing: 台帳が全裸/裸と記録した相手が本文で「服を着」扱い、またはその逆
//
// 出力は 1 ターン 1 行の JSONL（drift: 項目ごとの食い違い件数、evidence: 先頭断片）
// + 最終行に項目ごとのサマリ。--no-ledger で台帳を全消しした版を疑似的に試せる
// （その場合は location の「台帳が空で本文の場所が確定できん」扱いで件数が増える
// かを比較する口）。
//
// 使い方:
//   tsx script/bench/ledger-drift-check.ts --dirs <dir1,dir2,...> [--no-ledger]

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const BODY_MARKER = "# --- ここから本文 ---";
const TURN_FILE = /^([A-Za-z]+)-(\d+)-.*\.txt$/;

// 場所語: 台帳の location と本文の両方に当てる語彙。左が先勝ち（長い方を先に書く）。
const LOCATION_LEXICON: readonly [string, string][] = [
  ["ベッド", "bed"],
  ["布団", "futon"],
  ["ソファ", "sofa"],
  ["風呂", "bath"],
  ["シャワー", "shower"],
  ["キッチン", "kitchen"],
  ["台所", "kitchen"],
  ["リビング", "living"],
  ["玄関", "entrance"],
  ["廊下", "hallway"],
  ["トイレ", "toilet"],
  ["屋上", "rooftop"],
  ["学校", "school"],
  ["教室", "classroom"],
  ["職場", "workplace"],
  ["ホテル", "hotel"],
  ["車", "car"],
  ["公園", "park"],
  ["外", "outside"],
];

const TIME_LEXICON: readonly [string, string][] = [
  ["明け方", "dawn"],
  ["早朝", "early-morning"],
  ["朝", "morning"],
  ["昼", "noon"],
  ["夕方", "evening"],
  ["夕暮れ", "evening"],
  ["深夜", "midnight"],
  ["夜", "night"],
];

// 服の食い違いは「裸系の語」と「着衣系の語」の組だけ見る（部分一致の誤爆を避けるため
// 「裸」単体ではなく「全裸/裸にな/裸の/はだか」側だけ）。
const NUDE_PATTERN = /全裸|裸にな|裸の|はだか|一糸まとわぬ|下着姿/;
const DRESSED_PATTERN = /服を着|着替え|制服姿|パジャマ姿|着たまま|服のまま/;

export type LedgerRow = {
  character: string;
  turn: number;
  location: string | null;
  time: string | null;
  clothing: Record<string, string>;
};

export type DriftRow = {
  file: string;
  character: string;
  turn: number;
  drift: { location: number; time: number; clothing: number };
  hitCount: number;
  evidence: string[];
};

const lexemeIn = (text: string, lexicon: readonly [string, string][]): Set<string> => {
  const found = new Set<string>();
  for (const [word, key] of lexicon) if (text.includes(word)) found.add(key);
  return found;
};

const readTurn = (
  path: string,
): { character: string; turn: number; body: string } => {
  const lines = readFileSync(path, "utf8").split("\n");
  const bodyStart = lines.indexOf(BODY_MARKER) + 1;
  if (bodyStart <= 0) throw new Error(`本文マーカーが無い: ${path}`);
  const name = basename(path).match(TURN_FILE);
  return {
    character: name?.[1] ?? "?",
    turn: Number(name?.[2] ?? "0") || 0,
    body: lines.slice(bodyStart).join("\n"),
  };
};

export const loadLedger = (dir: string): Map<string, LedgerRow> => {
  const map = new Map<string, LedgerRow>();
  try {
    const raw = readFileSync(join(dir, "ledger.jsonl"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as LedgerRow;
      map.set(`${row.character}:${row.turn}`, row);
    }
  } catch {
    // ledger.jsonl が無い run は「台帳無し」として全部の場所判定を落とす。
  }
  return map;
};

export const scanTurn = (body: string, ledger: LedgerRow | null): DriftRow["drift"] => {
  const textLocations = lexemeIn(body, LOCATION_LEXICON);
  const textTimes = lexemeIn(body, TIME_LEXICON);
  let location = 0;
  let time = 0;
  let clothing = 0;
  if (!ledger) {
    // 台帳が無い版: 本文が場所・時刻を確定しても突き合わせる相手が無いので
    // 「確定できん」として件数に数える（わざと消した版で増えるかの確認口）。
    if (textLocations.size > 0) location += 1;
    if (textTimes.size > 0) time += 1;
    return { location, time, clothing };
  }
  if (ledger.location) {
    const ledgerLocations = lexemeIn(ledger.location, LOCATION_LEXICON);
    // 台帳の場所と語彙が重ならん本文側の場所語 = 食い違い。
    for (const key of textLocations) if (!ledgerLocations.has(key)) location += 1;
  } else if (textLocations.size > 1) {
    // 台帳が場所を持たんのに本文が複数の場所を行き来した = 台帳が追えてない。
    location += 1;
  }
  if (ledger.time) {
    const ledgerTimes = lexemeIn(ledger.time, TIME_LEXICON);
    for (const key of textTimes) if (!ledgerTimes.has(key)) time += 1;
  }
  const textNude = NUDE_PATTERN.test(body);
  const textDressed = DRESSED_PATTERN.test(body);
  const ledgerSaysNude = Object.values(ledger.clothing).some((state) =>
    NUDE_PATTERN.test(state),
  );
  const ledgerSaysDressed = Object.values(ledger.clothing).some((state) =>
    DRESSED_PATTERN.test(state),
  );
  if (textNude && ledgerSaysDressed && !ledgerSaysNude) clothing += 1;
  if (textDressed && ledgerSaysNude && !ledgerSaysDressed) clothing += 1;
  return { location, time, clothing };
};

export const scanDir = (dir: string, noLedger = false): DriftRow[] => {
  const ledgerMap = noLedger ? new Map<string, LedgerRow>() : loadLedger(dir);
  return readdirSync(dir)
    .filter((name) => TURN_FILE.test(name))
    .map((name) => {
      const turn = readTurn(join(dir, name));
      const ledger = ledgerMap.get(`${turn.character}:${turn.turn}`) ?? null;
      const drift = scanTurn(turn.body, ledger);
      const evidence: string[] = [];
      if (drift.location) evidence.push(`location台帳=${ledger?.location ?? "-"}`);
      if (drift.time) evidence.push(`time台帳=${ledger?.time ?? "-"}`);
      if (drift.clothing) evidence.push(`clothing台帳=${JSON.stringify(ledger?.clothing ?? {})}`);
      return {
        file: name,
        character: turn.character,
        turn: turn.turn,
        drift,
        hitCount: drift.location + drift.time + drift.clothing,
        evidence,
      };
    })
    .sort((a, b) => a.character.localeCompare(b.character) || a.turn - b.turn);
};

const main = (): void => {
  const args = process.argv.slice(2);
  const index = args.indexOf("--dirs");
  const dirs = index >= 0 ? args[index + 1].split(",").filter(Boolean) : [];
  if (dirs.length === 0) throw new Error("--dirs <dir,dir,...> が要る");
  const noLedger = args.includes("--no-ledger");
  for (const dir of dirs) {
    const rows = scanDir(dir, noLedger);
    for (const row of rows) console.log(JSON.stringify({ ...row, dir: basename(dir) }));
    const totals = {
      location: rows.reduce((sum, row) => sum + row.drift.location, 0),
      time: rows.reduce((sum, row) => sum + row.drift.time, 0),
      clothing: rows.reduce((sum, row) => sum + row.drift.clothing, 0),
      turns: rows.filter((row) => row.hitCount > 0).length,
    };
    console.log(
      JSON.stringify({ dir: basename(dir), scanned: rows.length, noLedger, totals }),
    );
  }
};

if (import.meta.url === `file://${process.argv[1]}`) main();
