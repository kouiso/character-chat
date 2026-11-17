// RIT-73 の実モデル確かめ（staging）。fixture の 10 発言を 1 ターンずつ送り、
// 返事の done から記憶の行ができるまでの秒数・category・subject を記録する。
// 使い方: pnpm exec tsx apps/v2/script/memory-extract-check.ts --env staging
// 要る変数（無い時は実行せず「未確認」で止まる）:
//   V2_STAGING_URL … staging の Worker の URL（例 https://adult-ai-v2-staging.<acct>.workers.dev）
//   BASIC_AUTH_USERNAME / BASIC_AUTH_PASSWORD … staging の secret と同じ値
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID … D1 を読むため（SELECT だけ）
//   V2_CHECK_CHARACTER_ID … 省略時は直近の v2 会話が使ったキャラを使う
// OPENROUTER_API_KEY は staging の Worker の secret なので手元には要らない。
// 上限: 返事 10 回＋抜き出し 10 回（fixture の発言数そのまま）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STAGING_D1 = "character-chat-v2-staging";
const WRANGLER_CONFIG = join(import.meta.dirname, "../wrangler.jsonc");
const FIXTURE = join(import.meta.dirname, "../../../packages/bench/fixture/memory-extract-10.json");
// NFR-1（done から記憶の行まで 60 秒以内）＋ Queue の retry_delay 30 秒の余裕。
const LEARNED_POLL_MS = 3_000;
const LEARNED_WAIT_LIMIT_MS = 75_000;
const TURN_TIMEOUT_MS = 240_000;

const REQUIRED_VARS = [
  "V2_STAGING_URL",
  "BASIC_AUTH_USERNAME",
  "BASIC_AUTH_PASSWORD",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

const unverified = (reason: string): never => {
  // 「未確認」は失敗ではなく、確かめられなかった行として票へ書く印。
  console.log(`未確認: ${reason}`);
  process.exit(0);
};

const authHeader = (): string =>
  `Basic ${Buffer.from(
    `${process.env.BASIC_AUTH_USERNAME}:${process.env.BASIC_AUTH_PASSWORD}`,
  ).toString("base64")}`;

// D1 は SELECT 専用で読む。staging の DB 名・env 名は wrangler.jsonc の束ねと同じ。
const queryD1 = <T>(sql: string): T[] => {
  const out = execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      STAGING_D1,
      "--env",
      "staging",
      "--remote",
      "--json",
      "--command",
      sql,
      "-c",
      WRANGLER_CONFIG,
    ],
    {
      encoding: "utf-8",
      timeout: 120_000,
      cwd: join(import.meta.dirname, ".."),
    },
  );
  const parsed = JSON.parse(out) as { results?: T[] }[];
  return parsed[0]?.results ?? [];
};

const pickCharacterId = (): string => {
  if (process.env.V2_CHECK_CHARACTER_ID) return process.env.V2_CHECK_CHARACTER_ID;
  const rows = queryD1<{ character_id: string }>(
    "SELECT character_id FROM v2_conversation ORDER BY updated_at DESC LIMIT 1",
  );
  if (rows[0]?.character_id) return rows[0].character_id;
  const fallback = queryD1<{ id: string }>("SELECT id FROM character LIMIT 1");
  if (fallback[0]?.id) return fallback[0].id;
  return unverified("staging に使えるキャラが見つからない（V2_CHECK_CHARACTER_ID を指定して）");
};

type SseEvent = { event: string; data: Record<string, unknown> };

// SSE の本文を全部受け取って event/data の組にする。done・error で返事の終わりを見る。
const parseSse = (body: string): SseEvent[] =>
  body
    .split("\n\n")
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) return null;
      try {
        return { event, data: JSON.parse(data) as Record<string, unknown> };
      } catch {
        return null;
      }
    })
    .filter((item): item is SseEvent => item !== null);

// 1 ターン送って done を待つ。戻り値は done の時刻とターン番号。
const sendTurn = async (
  base: string,
  characterId: string,
  conversationId: string,
  text: string,
): Promise<{ doneAt: number; turn: number }> => {
  const response = await fetch(`${base}/api/chat/${encodeURIComponent(characterId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(),
    },
    body: JSON.stringify({
      conversationId,
      requestId: crypto.randomUUID(),
      text,
    }),
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`chat POST failed: HTTP ${response.status}`);
  const events = parseSse(await response.text());
  const done = events.find((item) => item.event === "done");
  if (!done) throw new Error("done が届かなかった（error/stopped の可能性）");
  const turn = Number(done.data.turn);
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("done の turn が不正");
  return { doneAt: Date.now(), turn };
};

type LearnedResponse = {
  state: string;
  memories: { id: string; content: string }[];
};

// 「そのターンで覚えた事」の読む口（RIT-92 FR-13）。done まで 3 秒おきに聞く。
const waitLearned = async (
  base: string,
  characterId: string,
  conversationId: string,
  turn: number,
  deadline: number,
): Promise<LearnedResponse> => {
  const url = `${base}/api/characters/${encodeURIComponent(
    characterId,
  )}/memories/learned?conversationId=${encodeURIComponent(conversationId)}&turn=${turn}`;
  for (;;) {
    const response = await fetch(url, {
      headers: { authorization: authHeader() },
    });
    if (!response.ok) throw new Error(`learned GET failed: HTTP ${response.status}`);
    const body = (await response.json()) as LearnedResponse;
    if (body.state !== "pending") return body;
    if (Date.now() >= deadline) return body;
    await new Promise((resolve) => setTimeout(resolve, LEARNED_POLL_MS));
  }
};

type TurnResult = {
  index: number;
  text: string;
  state: string;
  seconds: number | null;
  categories: string[];
  subjects: string[];
  errorCode: string | null;
};

// 発言 1 件を送り、done → 記憶の行（learned か D1 の job 状態）までの秒数を採る。
const measureTurn = async (
  base: string,
  characterId: string,
  conversationId: string,
  text: string,
  index: number,
): Promise<TurnResult> => {
  const { doneAt, turn } = await sendTurn(base, characterId, conversationId, text);
  const deadline = doneAt + LEARNED_WAIT_LIMIT_MS;
  const learned = await waitLearned(base, characterId, conversationId, turn, deadline);
  const [job] = queryD1<{ state: string; error_code: string | null }>(
    `SELECT state, error_code FROM v2_memory_job WHERE conversation_id = '${conversationId}' AND source_turn = ${turn}`,
  );
  const rows = queryD1<{ category: string; subject: string }>(
    `SELECT m.category, m.subject FROM v2_memory m JOIN v2_memory_source s ON s.memory_id = m.id JOIN v2_memory_job j ON s.source_message_id = j.source_message_id WHERE j.conversation_id = '${conversationId}' AND j.source_turn = ${turn}`,
  );
  const finished = learned.state === "done" ? Date.now() : null;
  return {
    index,
    text,
    state: job?.state ?? learned.state,
    seconds: finished === null ? null : Math.round((finished - doneAt) / 1000),
    categories: rows.map((row) => row.category),
    subjects: rows.map((row) => row.subject),
    errorCode: job?.error_code ?? null,
  };
};

const main = async (): Promise<void> => {
  if (!process.argv.includes("--env") || !process.argv.includes("staging")) {
    unverified("使い方: tsx apps/v2/script/memory-extract-check.ts --env staging");
  }
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) unverified(`環境変数が無い: ${missing.join(", ")}`);
  const base = (process.env.V2_STAGING_URL ?? "").replace(/\/$/, "");
  const health = await fetch(`${base}/api/health`, {
    headers: { authorization: authHeader() },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!health?.ok)
    unverified(`GET ${base}/api/health が 200 を返さない（URL・Basic 認証を確かめる）`);

  const utterances = JSON.parse(readFileSync(FIXTURE, "utf-8")) as string[];
  const characterId = pickCharacterId();
  const conversationId = crypto.randomUUID();
  console.log(`character=${characterId} conversation=${conversationId} turns=${utterances.length}`);

  const results: TurnResult[] = [];
  for (const [index, text] of utterances.entries()) {
    results.push(await measureTurn(base, characterId, conversationId, text, index + 1));
  }
  console.log("turn | state | done→行の秒数 | category | subject");
  for (const row of results) {
    console.log(
      `${row.index} | ${row.state}${row.errorCode ? `(${row.errorCode})` : ""} | ${
        row.seconds === null ? "-" : `${row.seconds}s`
      } | ${row.categories.join(",") || "-"} | ${row.subjects.join(",") || "-"}`,
    );
  }
};

await main().catch((error: unknown) => {
  // 失敗も「未確認」扱いにせん — 壊れた記録を票の証拠にしないため止まる。
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
