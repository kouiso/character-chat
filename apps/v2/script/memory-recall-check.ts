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
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const v2Root = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = path.resolve(v2Root, "../../packages/bench/fixture/memory-recall-29.json");
const STAGING_DB = "character-chat-v2-staging";
const STAGING_INDEX = "character-chat-v2-staging";
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

// 検索箱の namespace は packages/engine の memoryNamespace と同じ計算。
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const memoryNamespace = (userId: string, characterId: string): string =>
  sha256(JSON.stringify([userId, characterId]));

// D1 には embedding が済んでいても検索箱への反映が間に合わん事がある（投入直後の
// ターンで取りこぼす実害を踏んだ）。可視性は get-vectors ではなく query で測る —
// 製品が読む経路（vectorize query + conversation filter）と同じ物を待つので
// 「記録済みだが検索に出ない」期間だけを正確に待てる。
const wranglerMemoryQuery = async (args: {
  values: number[];
  namespace: string;
  conversationId: string;
}): Promise<Set<string>> => {
  const out = await new Promise<{ stdout: string }>((resolve, reject) => {
    execFile(
      "pnpm",
      [
        "exec",
        "wrangler",
        "vectorize",
        "query",
        STAGING_INDEX,
        "--env",
        "staging",
        "--vector",
        ...args.values.map((value) => String(value)),
        "--namespace",
        args.namespace,
        "--top-k",
        "50",
        "--return-metadata",
        "all",
        "--filter",
        JSON.stringify({
          conversation_id: args.conversationId,
          kind: { $in: ["fact", "preference"] },
        }),
      ],
      { cwd: v2Root, timeout: 120_000, env: process.env },
      (error, stdout) => (error ? reject(error) : resolve({ stdout })),
    );
  });
  const found = new Set<string>();
  for (const match of out.stdout.matchAll(/"memory_id":\s*"([^"]+)"/g)) {
    found.add(match[1]);
  }
  return found;
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
const waitSettled = async (
  conversationId: string,
): Promise<{ ms: number; settled: boolean; phase?: string }> => {
  const startedAt = Date.now();
  for (;;) {
    // wrangler 呼び出しは瞬断するので、失敗は「まだ済んでいない」として次を待つ。
    // 連続で失敗し続けても枠の時間切れで終わる。
    const rows = await wranglerQuery(
      `SELECT` +
        ` (SELECT COUNT(*) FROM v2_memory_job WHERE conversation_id = '${conversationId}'` +
        `   AND state IN ('pending','queued')) AS pending_jobs,` +
        ` (SELECT COUNT(*) FROM v2_memory WHERE conversation_id = '${conversationId}'` +
        `   AND deleted_at IS NULL AND embedding IS NULL) AS unindexed`,
    ).catch(() => null);
    // null は読み取り失敗 — 落ち着いたとは言えないので次を待つ。
    if (rows !== null) {
      const row = rows[0] ?? {};
      if (Number(row.pending_jobs ?? 0) === 0 && Number(row.unindexed ?? 0) === 0) {
        return { ms: Date.now() - startedAt, settled: true };
      }
    }
    if (Date.now() - startedAt > SETTLE_WAIT_MS) {
      return { ms: Date.now() - startedAt, settled: false, phase: "d1" };
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
};

// D1 の索引完了の次は検索箱の反映を待つ。見えない内に進むと質問ターンで
// 取りこぼして試験が嘘の失敗をする（実害: confusion 会話 turn 3）。
// get-vectors の可視性は upsert 直後でも遅れるので、ここは D1 settle とは
// 別の枠を持つ（合算だと抽出ジョブが枠を食って必ず切れる）。
const VECTOR_VISIBLE_WAIT_MS = 300_000;
const waitVectorVisible = async (
  conversationId: string,
): Promise<{ ms: number; settled: boolean; phase?: string }> => {
  const startedAt = Date.now();
  // プローブのクエリベクトルには会話内のどれかの embedding を使う。
  // 検索箱は conversation_id で絞るので、どれで聞いても見える全件が返る。
  for (;;) {
    const probe = await wranglerQuery(
      `SELECT m.embedding AS embedding, c.user_id AS user_id, c.character_id AS character_id` +
        ` FROM v2_memory m JOIN v2_conversation c ON c.id = m.conversation_id` +
        ` WHERE m.conversation_id = '${conversationId}' AND m.embedding IS NOT NULL LIMIT 1`,
    ).catch(() => null);
    if (probe === null) {
      // 読み取りの瞬断は次を待つ。
    } else if (probe.length === 0) {
      // 記憶がまだ無いターンは検索箱を待つ必要が無い。
      return { ms: Date.now() - startedAt, settled: true };
    } else {
      const row = probe[0] as {
        embedding: number[];
        user_id: string;
        character_id: string;
      };
      const values = Array.from(new Float32Array(new Uint8Array(row.embedding).buffer));
      const visible = await wranglerMemoryQuery({
        values,
        namespace: memoryNamespace(row.user_id, row.character_id),
        conversationId,
      }).catch(() => new Set<string>());
      const expected = await wranglerQuery(
        `SELECT id FROM v2_memory WHERE conversation_id = '${conversationId}'` +
          ` AND deleted_at IS NULL AND embedding IS NOT NULL AND kind IN ('fact','preference')`,
      ).catch(() => null);
      if (
        expected !== null &&
        expected.every((row) => typeof row.id === "string" && visible.has(row.id as string))
      ) {
        return { ms: Date.now() - startedAt, settled: true };
      }
    }
    if (Date.now() - startedAt > VECTOR_VISIBLE_WAIT_MS) {
      return { ms: Date.now() - startedAt, settled: false, phase: "vector" };
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
  // wrangler が瞬断した時に嘘の「記憶未使用」へならんよう、数回はやり直す。
  let rows: Record<string, unknown>[] | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    rows = await wranglerQuery(
      `SELECT g.id AS generation_id, g.memory_retrieval AS memory_retrieval,` +
        ` m.memory_id AS memory_id, m.rank AS rank, m.via AS via, mem.content AS content` +
        ` FROM v2_generation g` +
        ` LEFT JOIN v2_generation_memory m ON m.generation_id = g.id` +
        ` LEFT JOIN v2_memory mem ON mem.id = m.memory_id` +
        ` WHERE g.conversation_id = '${conversationId}' AND g.turn = ${turn} AND g.status = 'ok'` +
        ` ORDER BY g.created_at DESC, m.rank ASC`,
    ).catch(() => null);
    if (rows !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  if (rows === null) return null;
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
    const settleD1 = await waitSettled(conversationId);
    const settle =
      settleD1.settled === false
        ? settleD1
        : await waitVectorVisible(conversationId).then((result) => ({
            ...result,
            ms: settleD1.ms + result.ms,
          }));
    // 索引が落ち着かんまま進むと、未索引の記憶の有無で結果がぶれるのでここで止める。
    if (!settle.settled) {
      fail(`索引の待機が時間切れ（${name} turn ${step.turn}・${settle.phase ?? "unknown"}相）`);
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
