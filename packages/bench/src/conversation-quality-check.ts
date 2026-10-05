// Phase 1 解析（会話品質）。transcript .txt を読み直して、各ターンの本文が
// 「直前の相手の発言に応答しているか」「相手の身体動作を捏造していないか」を測る。
// LLM は呼ばない。判定は本文の文字列照合だけ。
//
// 使い方:
//   tsx src/conversation-quality-check.ts --dirs <dir1,dir2,...>
// 出力は 1 ターン 1 行の JSONL + ディレクトリごとのサマリ。

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const USER_MARKER = "# --- そのターンで送った相手の発言 ---";
const BODY_MARKER = "# --- ここから本文 ---";
const TURN_FILE = /^([A-Za-z]+)-(\d+)-.*\.txt$/;
const HEADER_FIELD = /^# ([A-Za-z]+): (.*)$/;
const USER_LINE = /^# > (.*)$/;

// 助詞・指示・相槌だけを拾っても「応答した」にはならん。内容語だけ残す。
const STOP_WORDS = new Set([
  "あなた",
  "あんた",
  "あたし",
  "わたし",
  "私",
  "僕",
  "俺",
  "君",
  "きみ",
  "それ",
  "これ",
  "あれ",
  "その",
  "この",
  "あの",
  "そこ",
  "ここ",
  "どこ",
  "なに",
  "何",
  "どう",
  "もう",
  "まだ",
  "ちょっと",
  "ください",
  "下さい",
  "です",
  "ます",
  "した",
  "して",
  "する",
  "って",
  "けど",
  "から",
  "まで",
  "より",
  "ので",
  "のに",
  "でも",
  "そして",
  "それから",
]);

// 二人称で相手の身体動作を書いてしまう型。キャラ自身の身体描写は対象外。
const USER_ACTION_PATTERNS: RegExp[] = [
  /あなたの手が/,
  /あなたの指が/,
  /あなたが腕を/,
  /あなたは.+掴/,
  /君の手が/,
];

const QUOTED_FRAGMENT = /["“「『]([^"”」』]{2,})["”」』]/g;
const CONTENT_WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu;

const readHeader = (lines: string[]): { fields: Map<string, string>; bodyStart: number } => {
  const fields = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    if (line === BODY_MARKER) return { fields, bodyStart: index + 1 };
    const match = line.match(HEADER_FIELD);
    if (match) fields.set(match[1], match[2]);
  }
  return { fields, bodyStart: -1 };
};

const readUserUtterance = (lines: string[], bodyStart: number): string => {
  const markerAt = lines.lastIndexOf(USER_MARKER, Math.max(0, bodyStart - 1));
  if (markerAt === -1) return "";
  const parts: string[] = [];
  for (const line of lines.slice(markerAt + 1, bodyStart)) {
    const match = line.match(USER_LINE);
    if (match) parts.push(match[1]);
  }
  return parts.join("\n").trim();
};

const readTurn = (
  path: string,
): { character: string; turn: number; userText: string; body: string } => {
  const lines = readFileSync(path, "utf8").split("\n");
  const { fields, bodyStart } = readHeader(lines);
  if (bodyStart === -1) throw new Error(`本文マーカーが無い: ${path}`);
  const name = basename(path).match(TURN_FILE);
  return {
    character: name?.[1] ?? fields.get("character") ?? "?",
    turn: Number(name?.[2] ?? "0") || 0,
    userText: readUserUtterance(lines, bodyStart),
    body: lines.slice(bodyStart).join("\n"),
  };
};

const unique = (values: string[]): string[] => [...new Set(values)];

export const userTokens = (userText: string): string[] => {
  const quoted = [...userText.matchAll(QUOTED_FRAGMENT)].map((match) => match[1].trim());
  const words = [...userText.matchAll(CONTENT_WORD)]
    .map((match) => match[0])
    .filter((word) => !STOP_WORDS.has(word));
  return unique([...quoted, ...words]).filter((token) => token.length >= 2);
};

const clip = (text: string, limit = 48): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}…`;

export type QualityTurnRow = {
  file: string;
  character: string;
  turn: number;
  respondsToUser: boolean;
  inventsUserAction: boolean;
  hasDialogue: boolean;
  emptyBody: boolean;
  evidence: {
    respondsToUser: string;
    inventsUserAction: string;
    hasDialogue: string;
    emptyBody: string;
  };
};

// 助詞で割った 2 文字スライスは「って」「れて」まで拾って全部合格になる。
// 内容語そのものか、4 文字以上の連続部分だけを応答の証拠にする。
const MIN_SLICE = 4;

const overlappingToken = (tokens: string[], body: string): string | undefined => {
  const hits = tokens
    .map((token) => {
      if (body.includes(token)) return token;
      if (token.length < MIN_SLICE) return undefined;
      for (let length = token.length - 1; length >= MIN_SLICE; length -= 1) {
        for (let start = 0; start + length <= token.length; start += 1) {
          const slice = token.slice(start, start + length);
          if (body.includes(slice)) return slice;
        }
      }
      return undefined;
    })
    .filter((hit): hit is string => hit !== undefined);
  return hits.sort((a, b) => b.length - a.length)[0];
};

const scoreTurn = (
  userText: string,
  body: string,
): Omit<QualityTurnRow, "file" | "character" | "turn"> => {
  const trimmed = body.trim();
  const emptyBody = trimmed.length === 0;
  const tokens = userTokens(userText);
  const hit = overlappingToken(tokens, body);
  const respondsToUser = tokens.length === 0 ? true : hit !== undefined;
  const action = USER_ACTION_PATTERNS.map((pattern) => body.match(pattern)).find((match) => match);
  const dialogue = body.match(/「[^」]*」|『[^』]*』/);
  return {
    respondsToUser,
    inventsUserAction: action !== undefined,
    hasDialogue: dialogue !== null,
    emptyBody,
    evidence: {
      respondsToUser:
        tokens.length === 0 ? "no-user-token" : hit !== undefined ? clip(hit) : "no-overlap",
      inventsUserAction: action ? clip(action[0]) : "",
      hasDialogue: dialogue ? clip(dialogue[0]) : emptyBody ? "empty-body" : "no-dialogue",
      emptyBody: emptyBody ? "empty" : String(trimmed.length),
    },
  };
};

export const scanDir = (dir: string): QualityTurnRow[] =>
  readdirSync(dir)
    .filter((name) => TURN_FILE.test(name))
    .map((name) => {
      const turn = readTurn(join(dir, name));
      return {
        file: name,
        character: turn.character,
        turn: turn.turn,
        ...scoreTurn(turn.userText, turn.body),
      };
    })
    .sort((a, b) => a.character.localeCompare(b.character) || a.turn - b.turn);

const FAILING_TOTALS = ["respondsToUser", "inventsUserAction", "hasDialogue", "emptyBody"] as const;

const failingCount = (rows: QualityTurnRow[], key: (typeof FAILING_TOTALS)[number]): number => {
  if (key === "respondsToUser" || key === "hasDialogue")
    return rows.filter((row) => !row[key]).length;
  return rows.filter((row) => row[key]).length;
};

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
    const totals = Object.fromEntries(FAILING_TOTALS.map((key) => [key, failingCount(rows, key)]));
    console.log(JSON.stringify({ dir: basename(dir), scanned: rows.length, totals }));
  }
};

// 空白や日本語を含むパスは import.meta.url 側だけパーセントエンコードされ、
// Windows では区切りとドライブ表記も違う。文字列連結で比べると直接起動を見落とす。
export const isEntryPoint = (moduleUrl: string, scriptPath: string | undefined): boolean =>
  scriptPath !== undefined && pathToFileURL(scriptPath).href === moduleUrl;

if (isEntryPoint(import.meta.url, process.argv[1])) main();
