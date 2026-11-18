// RIT-86 の実モデル確かめ（staging 通し試験）。
// fixture の発言を staging の /api/chat/:characterId へ Basic 認証で順に送り、
// 各発言の抜き出しが終わるのを待ってから次を送る。記録する物:
// 3 つの記憶の subject が同じか、superseded_by の並び、4 ターン目の
// v2_generation_memory の行、返事の本文。
// 使い方: pnpm exec tsx apps/v2/script/memory-supersede-check.ts --character <id>
// 要る変数: V2_STAGING_URL / BASIC_AUTH_USERNAME / BASIC_AUTH_PASSWORD /
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID /
//   V2_STAGING_CHARACTER_ID（または --character）
// 鍵が無い時は実行せず「未確認」を出す。呼ぶ回数は返事 4 回＋抜き出し 3 回まで。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type FixtureTurn = { turn: number; userMsg: string; expectSubject?: string; question?: boolean };
type Fixture = { scenario: string; turns: FixtureTurn[] };
type MemoryRow = {
  id: string;
  subject: string;
  superseded_by: string | null;
  source_turn: number | null;
  content: string;
};
type StagingEnv = {
  url: string;
  user: string;
  pass: string;
  character: string;
};

const EXTRACTION_WAIT_MS = 120_000;
const POLL_MS = 5_000;
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const readEnv = (): StagingEnv | null => {
  const url = process.env.V2_STAGING_URL;
  const user = process.env.BASIC_AUTH_USERNAME;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  // 旗が無い時 indexOf は -1 → [0]（実行ファイルの道）を取ってしまうので先に見る
  const flagIndex = process.argv.indexOf("--character");
  const character =
    (flagIndex === -1 ? undefined : process.argv[flagIndex + 1]) ??
    process.env.V2_STAGING_CHARACTER_ID;
  // wrangler がリモート D1 を開くのに要る資格。無ければ実行自体を見送る。
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) return null;
  if (!url || !user || !pass || !character) return null;
  return { url, user, pass, character };
};

const d1Query = <T>(sql: string): T[] => {
  const result = execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "character-chat-v2-staging",
      "--env",
      "staging",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { cwd: APP_DIR, env: process.env, encoding: "utf8" },
  );
  const parsed = JSON.parse(result) as { results?: T[] }[] | { results?: T[] };
  return Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed.results ?? []);
};

const waitExtraction = async (conversationId: string, turn: number): Promise<void> => {
  const deadline = Date.now() + EXTRACTION_WAIT_MS;
  for (;;) {
    const rows = d1Query<{ state: string }>(
      `SELECT state FROM v2_memory_job WHERE conversation_id = '${conversationId}' AND source_turn = ${turn}`,
    );
    if (rows.length > 0 && rows.every((row) => row.state === "completed")) return;
    if (rows.some((row) => row.state === "failed"))
      throw new Error(`extraction failed (turn ${turn})`);
    if (Date.now() > deadline) throw new Error(`extraction timeout (turn ${turn})`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
};

const sendTurn = async (env: StagingEnv, conversationId: string, text: string): Promise<string> => {
  const response = await fetch(`${env.url}/api/chat/${env.character}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${env.user}:${env.pass}`).toString("base64")}`,
    },
    body: JSON.stringify({ conversationId, requestId: crypto.randomUUID(), text }),
  });
  if (!response.ok) throw new Error(`chat POST failed: ${response.status}`);
  // SSE を最後まで読み、chunk の本文をつなぐ。種類は event: 行、中身は data: 行に分かれる。
  const raw = await response.text();
  let said = "";
  let kind = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      kind = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) continue;
    if (kind !== "chunk") continue;
    const event = JSON.parse(line.slice(5).trim()) as { text?: string };
    if (event.text) said += event.text;
  }
  return said;
};

const main = async (): Promise<void> => {
  const env = readEnv();
  if (!env) {
    out("未確認: 必要な環境変数（V2_STAGING_URL・Basic認証・Cloudflare資格・キャラID）が無い");
    return;
  }
  const fixture = JSON.parse(
    readFileSync(
      path.resolve(APP_DIR, "../../packages/bench/fixture/memory-supersede-4.json"),
      "utf8",
    ),
  ) as Fixture;
  const conversationId = `rit86-${crypto.randomUUID()}`;
  const replies: Record<number, string> = {};
  for (const turn of fixture.turns) {
    replies[turn.turn] = await sendTurn(env, conversationId, turn.userMsg);
    if (!turn.question) await waitExtraction(conversationId, turn.turn);
  }
  const memories = d1Query<MemoryRow>(
    `SELECT id, subject, superseded_by, source_turn, content FROM v2_memory WHERE conversation_id = '${conversationId}' ORDER BY source_turn`,
  );
  const generationMemories = d1Query<unknown>(
    `SELECT * FROM v2_generation_memory WHERE conversation_id = '${conversationId}'`,
  );
  const report = {
    conversationId,
    replies,
    subjectsAligned:
      memories.length > 0 && memories.every((row) => row.subject === memories[0]?.subject),
    memories,
    generationMemories,
  };
  out(JSON.stringify(report, null, 2));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
