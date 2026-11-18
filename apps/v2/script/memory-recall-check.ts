// RIT-84: staging で「昔話した事実を後のターンで引けるか」を実モデルで確かめる通し試験。
// - recall 会話: 29 ターン（1〜3 に事実、4〜26 に関係無い雑談、27〜29 に質問）。
//   質問ターンは返事に事実の言葉が入り、v2_generation_memory にその記憶 id が在る事を見る。
// - confusion 会話: 「姉は看護師」と「母は小学校の先生」を植えて姉側を聞く。
//   記憶の塊で固定を除く一番目（検索の最小 rank）が姉の記憶である事を見る。
// 各ターンの発言は POST /api/chat/:id （Basic 認証・SSE）。返事の後、抜き出し
// （v2_memory_job の state）と索引（v2_memory.embedding）の完了を wrangler d1 で
// 最長 120 秒待つ。結果は stdout の JSON。
//
// 使い方: pnpm exec tsx apps/v2/script/memory-recall-check.ts --env staging
// 要る変数: V2_STAGING_URL・BASIC_AUTH_USERNAME・BASIC_AUTH_PASSWORD・
//   CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID（OPENROUTER_API_KEY は staging Worker の secret）
// 鍵が揃っていない時は実行せず status "unverified" で終わる。
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const v2Root = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = path.resolve(v2Root, "../../packages/bench/fixture/memory-recall-29.json");
const STAGING_DB = "character-chat-v2-staging";
const SETTLE_WAIT_MS = 120_000;
const SETTLE_POLL_MS = 5_000;

const REQUIRED_ENV = [
  "V2_STAGING_URL",
  "BASIC_AUTH_USERNAME",
  "BASIC_AUTH_PASSWORD",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

type FixtureTurn = {
  turn: number;
  text: string;
  check?: {
    replyIncludes?: string;
    memoryIncludes?: string;
    firstSearchMemoryIncludes?: string;
  };
};
type Fixture = {
  name: string;
  character: Record<string, unknown>;
  conversations: Record<string, { turns: FixtureTurn[] }>;
};

type UsedMemoryRow = {
  memoryId: string;
  rank: number;
  via: "pinned" | "search";
  content: string;
};
type TurnRecord = {
  conversation: string;
  turn: number;
  elapsedMs: number;
  settleMs: number;
  reply: string;
  generationId: string | null;
  memoryRetrieval: string | null;
  usedMemories: UsedMemoryRow[];
  checks: { name: string; ok: boolean; detail: string }[];
};

const fail = (message: string): never => {
  console.log(JSON.stringify({ status: "error", message }));
  process.exit(1);
};

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const wranglerQuery = async (sql: string): Promise<Record<string, unknown>[]> => {
  const out = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
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
      { cwd: v2Root, timeout: 120_000, env: process.env },
      (error, stdout, stderr) =>
        error
          ? reject(new Error(`wrangler d1 failed: ${error.message}; ${stderr}`))
          : resolve({ stdout, stderr }),
    );
  });
  const parsed: unknown = JSON.parse(out.stdout);
  const rows = Array.isArray(parsed)
    ? (parsed[0] as { results?: unknown[] } | undefined)?.results
    : undefined;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

const basic = (): string =>
  `Basic ${Buffer.from(`${process.env.BASIC_AUTH_USERNAME ?? ""}:${process.env.BASIC_AUTH_PASSWORD ?? ""}`).toString("base64")}`;

const postJson = async (url: string, body: unknown): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: { authorization: basic(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// SSE ブロック 1 個を event 名と data へ分ける。
const parseSseEvent = (raw: string): { event: string; data: string } => {
  let event = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    if (line.startsWith("data: ")) data += line.slice(6);
  }
  return { event, data };
};

// SSE 1 イベントを返事の組み立てへ反映する。error イベントはターンの失敗として投げる。
const applySseEvent = (
  event: string,
  data: string,
  state: { reply: string; generationId: string | null },
): void => {
  if (!data) return;
  const payload = JSON.parse(data) as { text?: string; generationId?: string | null };
  if (event === "chunk" && typeof payload.text === "string") state.reply += payload.text;
  if (event === "done") state.generationId = payload.generationId ?? null;
  if (event === "error") throw new Error(`turn error event: ${data}`);
};

// SSE 1 ターン分。chunk の本文を継ぎ、done の generationId を拾う。
const postTurn = async (
  baseUrl: string,
  characterId: string,
  conversationId: string,
  text: string,
): Promise<{ reply: string; generationId: string | null; elapsedMs: number }> => {
  const startedAt = Date.now();
  const response = await postJson(`${baseUrl}/api/chat/${encodeURIComponent(characterId)}`, {
    conversationId,
    requestId: randomUUID(),
    text,
  });
  if (!response.ok || !response.body) {
    throw new Error(`POST /api/chat failed: ${response.status} ${await response.text()}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { reply: "", generationId: null as string | null };
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const { event, data } = parseSseEvent(raw);
      applySseEvent(event, data, state);
    }
  }
  await reader.cancel().catch(() => {});
  return {
    reply: state.reply,
    generationId: state.generationId,
    elapsedMs: Date.now() - startedAt,
  };
};

// その会話の抜き出し（job）と索引（embedding）が終わるまで待つ。完了せず 120 秒で打ち切る。
const waitSettled = async (conversationId: string): Promise<{ ms: number; settled: boolean }> => {
  const startedAt = Date.now();
  for (;;) {
    const rows = await wranglerQuery(
      `SELECT` +
        ` (SELECT COUNT(*) FROM v2_memory_job WHERE conversation_id = '${conversationId}'` +
        `   AND state IN ('pending','queued')) AS pending_jobs,` +
        ` (SELECT COUNT(*) FROM v2_memory WHERE conversation_id = '${conversationId}'` +
        `   AND deleted_at IS NULL AND embedding IS NULL) AS unindexed`,
    );
    const row = rows[0] ?? {};
    if (Number(row.pending_jobs ?? 0) === 0 && Number(row.unindexed ?? 0) === 0) {
      return { ms: Date.now() - startedAt, settled: true };
    }
    if (Date.now() - startedAt > SETTLE_WAIT_MS) {
      return { ms: Date.now() - startedAt, settled: false };
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
};

const loadTurnUsage = async (
  conversationId: string,
  turn: number,
): Promise<{
  generationId: string;
  memoryRetrieval: string | null;
  used: UsedMemoryRow[];
} | null> => {
  const rows = await wranglerQuery(
    `SELECT g.id AS generation_id, g.memory_retrieval AS memory_retrieval,` +
      ` m.memory_id AS memory_id, m.rank AS rank, m.via AS via, mem.content AS content` +
      ` FROM v2_generation g` +
      ` LEFT JOIN v2_generation_memory m ON m.generation_id = g.id` +
      ` LEFT JOIN v2_memory mem ON mem.id = m.memory_id` +
      ` WHERE g.conversation_id = '${conversationId}' AND g.turn = ${turn} AND g.status = 'ok'` +
      ` ORDER BY g.created_at DESC, m.rank ASC`,
  );
  const generationId = rows.find((row) => row.generation_id)?.generation_id;
  if (typeof generationId !== "string") return null;
  const marker = rows.find((row) => row.generation_id === generationId)?.memory_retrieval;
  const used = rows
    .filter(
      (row): row is typeof row & { memory_id: string; rank: number; via: "pinned" | "search" } =>
        row.generation_id === generationId && typeof row.memory_id === "string",
    )
    .map((row) => ({
      memoryId: row.memory_id,
      rank: Number(row.rank),
      via: row.via,
      content: typeof row.content === "string" ? row.content : "",
    }));
  return {
    generationId,
    memoryRetrieval: typeof marker === "string" ? marker : null,
    used,
  };
};

const checkReplyIncludes = (
  expect: string | undefined,
  sentReply: string,
): TurnRecord["checks"][number] | null =>
  expect === undefined
    ? null
    : {
        name: "replyIncludes",
        ok: sentReply.includes(expect),
        detail: `返事に「${expect}」`,
      };

const checkMemoryIncludes = (
  expect: string | undefined,
  usage: Awaited<ReturnType<typeof loadTurnUsage>>,
): TurnRecord["checks"][number] | null =>
  expect === undefined
    ? null
    : {
        name: "memoryIncludes",
        ok: (usage?.used ?? []).some((row) => row.content.includes(expect)),
        detail: `v2_generation_memory に「${expect}」を含む記憶`,
      };

const checkFirstSearchMemory = (
  expect: string | undefined,
  usage: Awaited<ReturnType<typeof loadTurnUsage>>,
): TurnRecord["checks"][number] | null => {
  if (expect === undefined) return null;
  const first = (usage?.used ?? [])
    .filter((row) => row.via === "search")
    .sort((a, b) => a.rank - b.rank)[0];
  return {
    name: "firstSearchMemoryIncludes",
    ok: first === undefined ? false : first.content.includes(expect),
    detail: `検索の最小 rank が「${expect}」を含む記憶`,
  };
};

// 台本の check を実測へ照らす。合わん物は失敗として集める。
const buildTurnChecks = (
  step: FixtureTurn,
  sentReply: string,
  usage: Awaited<ReturnType<typeof loadTurnUsage>>,
): TurnRecord["checks"] =>
  [
    checkReplyIncludes(step.check?.replyIncludes, sentReply),
    checkMemoryIncludes(step.check?.memoryIncludes, usage),
    checkFirstSearchMemory(step.check?.firstSearchMemoryIncludes, usage),
  ].filter((check) => check !== null);

const runConversation = async (
  name: string,
  fixture: Fixture,
  baseUrl: string,
  characterId: string,
): Promise<TurnRecord[]> => {
  const conversationId = randomUUID();
  const records: TurnRecord[] = [];
  for (const step of fixture.conversations[name].turns) {
    const sent = await postTurn(baseUrl, characterId, conversationId, step.text);
    const settle = await waitSettled(conversationId);
    // 索引が落ち着かんまま進むと、未索引の記憶の有無で結果がぶれるのでここで止める。
    if (!settle.settled) {
      fail(`索引の待機が ${SETTLE_WAIT_MS}ms で時間切れ（${name} turn ${step.turn}）`);
    }
    const usage = await loadTurnUsage(conversationId, step.turn);
    const checks = buildTurnChecks(step, sent.reply, usage);
    records.push({
      conversation: name,
      turn: step.turn,
      elapsedMs: sent.elapsedMs,
      settleMs: settle.ms,
      reply: sent.reply,
      generationId: usage?.generationId ?? sent.generationId,
      memoryRetrieval: usage?.memoryRetrieval ?? null,
      usedMemories: usage?.used ?? [],
      checks,
    });
  }
  return records;
};

const main = async (): Promise<void> => {
  if (arg("env") !== "staging") {
    fail("この試験は --env staging 専用です（staging Worker と staging D1 へ接続します）。");
  }
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  const baseUrl = process.env.V2_STAGING_URL;
  if (missing.length > 0 || !baseUrl) {
    // 鍵が揃わん環境では走らせん。「未確認」として出して止める。
    console.log(JSON.stringify({ status: "unverified", missing }));
    return;
  }
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;

  // 検査専用のキャラを毎回立てる（非成人向け・記憶の種類は両方）。
  const created = await postJson(`${baseUrl.replace(/\/$/, "")}/api/characters`, fixture.character);
  if (created.status !== 201) {
    fail(`POST /api/characters failed: ${created.status} ${await created.text()}`);
  }
  const { id: characterId } = (await created.json()) as { id: string };
  const base = baseUrl.replace(/\/$/, "");

  const records = [
    ...(await runConversation("recall", fixture, base, characterId)),
    ...(await runConversation("confusion", fixture, base, characterId)),
  ];
  const failures = records.flatMap((record) =>
    record.checks
      .filter((check) => !check.ok)
      .map((check) => ({ ...check, conversation: record.conversation, turn: record.turn })),
  );
  console.log(
    JSON.stringify({
      status: failures.length === 0 ? "ok" : "failed",
      fixture: fixture.name,
      characterId,
      turns: records.map((record) => {
        const { reply, ...rest } = record;
        void reply;
        return rest;
      }),
      replies: Object.fromEntries(
        records
          .filter((record) => record.checks.length > 0)
          .map((record) => [`${record.conversation}#${record.turn}`, record.reply]),
      ),
      failures,
    }),
  );
  process.exit(failures.length === 0 ? 0 : 1);
};

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(`実行途中の例外: ${message}`);
});
