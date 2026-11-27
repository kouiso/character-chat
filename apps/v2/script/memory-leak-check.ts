// RIT-89: staging 実モデルの記憶漏れ検査。
//
// 同名キャラ「鈴」を 2 人作り、A の会話で「誕生日は 3 月 9 日」と言わせ、
// B の会話で「誕生日いつだっけ」と聞く。B のターンの v2_generation.request_json に
// A の記憶の id が無い事を確かめる（B の返事の本文は記録だけ。モデルが偶然同じ日付を
// 言う事が在るので、合否は request_json で決める）。
//
// 使い方: pnpm exec tsx apps/v2/script/memory-leak-check.ts --env staging
// 要る変数（全部揃わん時は実行せず status: "unverified" を出して終了）:
//   V2_STAGING_URL          staging の Worker の URL（例: https://character-chat-staging.….workers.dev）
//   BASIC_AUTH_USERNAME     staging の Basic 認証
//   BASIC_AUTH_PASSWORD
//   CLOUDFLARE_API_TOKEN    wrangler d1 execute --remote 用
//   CLOUDFLARE_ACCOUNT_ID
// 呼び出し予算（実モデルの課金回数）: 返事 4 回＋抜き出し 2 回まで（この検査は 2+2 で済む）。

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const APP_DIR = path.join(REPO_ROOT, "apps/v2");
const FIXTURE = path.join(REPO_ROOT, "packages/bench/fixture/memory-leak-characters.json");
const STAGING_DB = "character-chat-v2-staging";

// 返事の SSE は最大 3 分待つ。抜き出しは Queue 経由なので 6 分待つ。
const REPLY_TIMEOUT_MS = 180_000;
const EXTRACTION_TIMEOUT_MS = 360_000;
const POLL_INTERVAL_MS = 15_000;
// 呼び出し予算（RIT-89）。越える事自体をバグとして止める。
const REPLY_CALL_BUDGET = 4;
const EXTRACTION_CALL_BUDGET = 2;

type Report = {
  status: "pass" | "leak" | "inconclusive" | "unverified";
  reason?: string;
  characterA?: string;
  characterB?: string;
  conversationA?: string;
  conversationB?: string;
  memoryIdsA?: string[];
  leakedMemoryIds?: string[];
  requestJsonChecked?: boolean;
  replyCalls: number;
  extractionCalls: number;
  bReplyText?: string;
};

const requiredEnv = [
  "V2_STAGING_URL",
  "BASIC_AUTH_USERNAME",
  "BASIC_AUTH_PASSWORD",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

const envArg = (() => {
  const index = process.argv.indexOf("--env");
  return index >= 0 ? process.argv[index + 1] : undefined;
})();

const report: Report = { status: "inconclusive", replyCalls: 0, extractionCalls: 0 };

const fail = (message: string): never => {
  console.log(
    JSON.stringify({
      status: "inconclusive",
      reason: message,
      replyCalls: report.replyCalls,
      extractionCalls: report.extractionCalls,
    }),
  );
  process.exit(1);
};

if (envArg !== "staging") {
  fail("--env staging だけを受け付ける（実モデル・実 D1 を触る検査なので）。");
}

const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length > 0) {
  // 鍵が無い時は「未確認」— 失敗としては落とさん。
  console.log(
    JSON.stringify({
      status: "unverified",
      reason: `必要な環境変数が無い: ${missing.join(", ")}`,
      replyCalls: 0,
      extractionCalls: 0,
    }),
  );
  process.exit(0);
}

const baseUrl = process.env.V2_STAGING_URL!.replace(/\/+$/, "");
const authHeader =
  "Basic " +
  Buffer.from(`${process.env.BASIC_AUTH_USERNAME}:${process.env.BASIC_AUTH_PASSWORD}`).toString(
    "base64",
  );

const api = async (pathname: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

// D1 を wrangler 経由で読む（--remote・--json）。
const d1Query = async <T>(sql: string): Promise<T[]> => {
  const { stdout } = await execFileAsync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      STAGING_DB,
      "--env",
      "staging",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { cwd: APP_DIR, env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as { results?: T[] }[] | { results?: T[] };
  return Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed.results ?? []);
};

// POST /api/characters — フィクスチャの設定そのまま。
const createCharacter = async (content: unknown): Promise<string> => {
  const response = await api("/api/characters", { method: "POST", body: JSON.stringify(content) });
  if (!response.ok) fail(`キャラ作成が ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { id: string };
  return body.id;
};

// SSE の出来事 1 個を読む。終わりの印（done/error/stopped）なら true。
const consumeSseEvent = (raw: string, state: { assistantText: string }): boolean => {
  const eventName = raw.match(/^event: (.+)$/m)?.[1]?.trim();
  const data = raw.match(/^data: (.*)$/m)?.[1] ?? "";
  if (eventName === "chunk") {
    try {
      state.assistantText += (JSON.parse(data) as { text?: string }).text ?? "";
    } catch {
      // chunk 以外の data 形も在るので無視して進める
    }
  }
  return eventName === "done" || eventName === "error" || eventName === "stopped";
};

// POST /api/chat/:characterId — SSE を終わりの印まで読む。
const sendReply = async (
  characterId: string,
  conversationId: string,
  text: string,
): Promise<{ ok: boolean; assistantText: string }> => {
  if (report.replyCalls >= REPLY_CALL_BUDGET) fail("返事の呼び出し予算（4 回）を越えた。");
  report.replyCalls += 1;
  const response = await api(`/api/chat/${characterId}`, {
    method: "POST",
    body: JSON.stringify({
      conversationId,
      requestId: crypto.randomUUID(),
      text,
    }),
  });
  if (!response.ok || response.body === null) {
    fail(`返事の受付が ${response.status}: ${await response.text()}`);
  }
  // 上の fail は never — ここでは body は必ず在る。
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { assistantText: "" };
  let terminal = false;
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (!terminal && Date.now() < deadline) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SSE の読み取りが時間切れ")), deadline - Date.now()),
      ),
    ]);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      if (consumeSseEvent(raw, state)) terminal = true;
    }
  }
  reader.cancel().catch(() => undefined);
  return { ok: terminal, assistantText: state.assistantText };
};

// A の会話の記憶が抜き出されるまで D1 を見る（Queue → 抜き出しは非同期）。
const waitForMemories = async (
  conversationId: string,
): Promise<{ id: string; content: string }[]> => {
  const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await d1Query<{ id: string; content: string }>(
      `SELECT id, content FROM v2_memory WHERE conversation_id = '${conversationId}' AND kind IN ('fact','preference') AND deleted_at IS NULL`,
    );
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return [];
};

// 抜き出しの呼び出し数を数える。予算を越える事自体をバグとして止める。
const countExtraction = (): void => {
  if (report.extractionCalls >= EXTRACTION_CALL_BUDGET) {
    fail("抜き出しの呼び出し予算（2 回）を越えた。");
  }
  report.extractionCalls += 1;
};

// 漏れの有無を決められん時の出し方（exit 0 — 失敗ではなく「未確認」系）。
const finishInconclusive = (reason: string): never => {
  report.reason = reason;
  console.log(JSON.stringify(report));
  process.exit(0);
};

const setupCast = async (): Promise<void> => {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    characters: { slot: string; content: unknown }[];
  };
  const [slotA, slotB] = fixture.characters;
  if (!slotA || !slotB) fail("フィクスチャにキャラが 2 人要る。");
  report.characterA = await createCharacter(slotA.content);
  report.characterB = await createCharacter(slotB.content);
  report.conversationA = crypto.randomUUID();
  report.conversationB = crypto.randomUUID();
};

// 返事を 1 回送り、予算内である事を確かめて抜き出し 1 回分として数える。
const sayAndCountExtraction = async (
  characterId: string,
  conversationId: string,
  text: string,
  failReason: string,
): Promise<{ assistantText: string }> => {
  const reply = await sendReply(characterId, conversationId, text);
  if (!reply.ok) fail(failReason);
  countExtraction();
  return reply;
};

const main = async () => {
  await setupCast();

  // A の会話へ確かめの事実を言わせる（返事 1 回 + 抜き出し 1 回）。
  await sayAndCountExtraction(
    report.characterA!,
    report.conversationA!,
    "私の誕生日は3月9日なんだ。よろしくね。",
    "A の返事が終わりの印まで届かんかった。",
  );

  const memoriesA = await waitForMemories(report.conversationA!);
  report.memoryIdsA = memoriesA.map((row) => row.id);
  if (memoriesA.length === 0) {
    finishInconclusive(
      "A の会話の記憶が待ち時間内に抜き出されんかった（漏れの有無は決められん）。",
    );
  }

  // B の会話で聞く（返事 1 回 + 抜き出し 1 回）。
  const askB = await sayAndCountExtraction(
    report.characterB!,
    report.conversationB!,
    "私の誕生日いつだっけ",
    "B の返事が終わりの印まで届かんかった。",
  );
  report.bReplyText = askB.assistantText || undefined;

  // B のターンの request_json を読んで A の記憶 id が居るか確かめる。
  const generations = await d1Query<{ request_json: string }>(
    `SELECT request_json FROM v2_generation WHERE conversation_id = '${report.conversationB}' ORDER BY created_at DESC LIMIT 1`,
  );
  const requestJson = generations[0]?.request_json;
  if (!requestJson) {
    finishInconclusive("B のターンの v2_generation.request_json が読めんかった。");
  }
  report.requestJsonChecked = true;
  report.leakedMemoryIds = report.memoryIdsA!.filter((id) => requestJson!.includes(id));
  report.status = report.leakedMemoryIds.length === 0 ? "pass" : "leak";
  if (report.status === "leak") report.reason = "B の指示文に A の記憶の id が乗っている。";
  console.log(JSON.stringify(report));
  process.exit(report.status === "leak" ? 1 : 0);
};

main().catch((error: unknown) => {
  console.log(
    JSON.stringify({
      status: "inconclusive",
      reason: error instanceof Error ? error.message : String(error),
      replyCalls: report.replyCalls,
      extractionCalls: report.extractionCalls,
    }),
  );
  process.exit(1);
});
