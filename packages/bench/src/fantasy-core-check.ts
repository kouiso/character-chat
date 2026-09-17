// Phase 1 解析（芯チェック）。transcript .txt を読み直して、各ターンの本文に
// 【プレイヤーへの約束】（芯）の要素がどれだけ現れたかを測る読み取り専用スクリプト。
// パターンは judge の fantasyCoreCheck をそのまま使う（実装を二重に持たない）。
//
// 出力は 1 ターン 1 行の JSONL（items: 項目ごとの on/off、evidence: ヒット断片）+ 最終行に
// 項目ごとのヒットターン数サマリ。
//
// 使い方:
//   tsx src/fantasy-core-check.ts --dirs <dir1,dir2,...>

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { CORE_ITEMS, fantasyCoreCheck, type CoreItem } from "@v2/judge";

const BODY_MARKER = "# --- ここから本文 ---";
const TURN_FILE = /^([A-Za-z]+)-(\d+)-.*\.txt$/;
const HEADER_FIELD = /^# ([A-Za-z]+): (.*)$/;

// ヘッダを BODY_MARKER まで読んでフィールドを返す。本文開始行は呼び出し側で使う。
const readHeader = (lines: string[]): { fields: Map<string, string>; bodyStart: number } => {
  const fields = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    if (line === BODY_MARKER) return { fields, bodyStart: index + 1 };
    const match = line.match(HEADER_FIELD);
    if (match) fields.set(match[1], match[2]);
  }
  return { fields, bodyStart: -1 };
};

const readTurn = (path: string): { character: string; turn: number; body: string } => {
  const lines = readFileSync(path, "utf8").split("\n");
  const { fields, bodyStart } = readHeader(lines);
  if (bodyStart === -1) throw new Error(`本文マーカーが無い: ${path}`);
  const name = basename(path).match(TURN_FILE);
  return {
    character: name?.[1] ?? fields.get("character") ?? "?",
    turn: Number(name?.[2] ?? "0") || 0,
    body: lines.slice(bodyStart).join("\n"),
  };
};

export type CoreTurnRow = {
  file: string;
  character: string;
  turn: number;
  items: Record<CoreItem, boolean>;
  hitCount: number;
  evidence: Partial<Record<CoreItem, string>>;
};

export const scanDir = (dir: string): CoreTurnRow[] =>
  readdirSync(dir)
    .filter((name) => TURN_FILE.test(name))
    .map((name) => {
      const turn = readTurn(join(dir, name));
      const { items, evidence } = fantasyCoreCheck(turn.body);
      return {
        file: name,
        character: turn.character,
        turn: turn.turn,
        items,
        hitCount: CORE_ITEMS.filter((item) => items[item]).length,
        evidence,
      };
    })
    .sort((a, b) => a.character.localeCompare(b.character) || a.turn - b.turn);

const main = (): void => {
  const args = process.argv.slice(2);
  const readList = (name: string): string[] => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1].split(",").filter(Boolean) : [];
  };
  const dirs = readList("--dirs");
  if (dirs.length === 0) throw new Error("--dirs <dir,dir,...> が要る");
  for (const dir of dirs) {
    const rows = scanDir(dir);
    for (const row of rows) console.log(JSON.stringify({ ...row, dir: basename(dir) }));
    const totals = Object.fromEntries(
      CORE_ITEMS.map((item) => [item, rows.filter((row) => row.items[item]).length]),
    ) as Record<CoreItem, number>;
    console.log(JSON.stringify({ dir: basename(dir), scanned: rows.length, totals }));
  }
};

if (import.meta.url === `file://${process.argv[1]}`) main();
