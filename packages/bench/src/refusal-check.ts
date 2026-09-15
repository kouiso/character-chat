// Phase 1 解析（plan v21 work item 1）。transcript の本文を既存の拒否パターン
// （functions/api/lib/refusal-detect.ts の HARD_REFUSAL_PATTERNS）で走査する読み取り専用
// チェッカー。パターンを別実装で持つと漏れがズレるので、ランタイム側と同じ配列を import する。
//
// AI 人格キャラ向けゲート: --ai-persona <label,label,...> を付けると、そのキャラの
// ターンでは末尾 AI_DECLARATION_PATTERN_COUNT 件（OOC AI 宣言系）を飛ばす。
//
// 使い方:
//   tsx src/refusal-check.ts --dirs <dir1,dir2,...> [--ai-persona <label,...>]
//   出力はヒットごとに 1 行の JSONL + 最終行にサマリ。ヒット 0 なら detail は空。

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  AI_DECLARATION_PATTERN_COUNT,
  HARD_REFUSAL_PATTERNS,
} from "../../../functions/api/lib/refusal-detect";

const BODY_MARKER = "# --- ここから本文 ---";
const TURN_FILE = /^([A-Za-z]+)-(\d+)-.*\.txt$/;

const readBody = (path: string): string => {
  const text = readFileSync(path, "utf8");
  const at = text.indexOf(BODY_MARKER);
  return at === -1 ? text : text.slice(at + BODY_MARKER.length);
};

export type RefusalHit = {
  file: string;
  character: string;
  turn: number;
  patternIndex: number;
  matched: string;
};

export const scanDirs = (
  dirs: string[],
  aiPersonas: Set<string>,
): { scanned: number; hits: RefusalHit[] } => {
  // AI 人格ゲート: パターン末尾の AI 宣言系を対象キャラでは外す。
  const corePatterns = HARD_REFUSAL_PATTERNS.slice(
    0,
    HARD_REFUSAL_PATTERNS.length - AI_DECLARATION_PATTERN_COUNT,
  );
  const aiPatterns = HARD_REFUSAL_PATTERNS.slice(-AI_DECLARATION_PATTERN_COUNT);
  let scanned = 0;
  const hits: RefusalHit[] = [];
  const scanFile = (dir: string, name: string): void => {
    const match = name.match(TURN_FILE);
    if (!match) return;
    const [, label, turn] = match;
    const body = readBody(join(dir, name));
    const patterns = aiPersonas.has(label) ? corePatterns : [...corePatterns, ...aiPatterns];
    scanned += 1;
    for (const [patternIndex, pattern] of patterns.entries()) {
      const found = body.match(pattern);
      if (found) {
        hits.push({
          file: name,
          character: label,
          turn: Number(turn),
          patternIndex,
          matched: found[0],
        });
      }
    }
  };
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) scanFile(dir, name);
  }
  return { scanned, hits };
};

const main = (): void => {
  const args = process.argv.slice(2);
  const readList = (name: string): string[] => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1].split(",").filter(Boolean) : [];
  };
  const dirs = readList("--dirs");
  if (dirs.length === 0) throw new Error("--dirs <dir,dir,...> が要る");
  const { scanned, hits } = scanDirs(dirs, new Set(readList("--ai-persona")));
  for (const hit of hits) console.log(JSON.stringify(hit));
  console.log(JSON.stringify({ scanned, hits: hits.length }));
};

if (import.meta.url === `file://${process.argv[1]}`) main();
