import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// バックグラウンド受け取り: クライアントがタブを閉じても、完走した生成結果が
// サーバ側で D1（message 行＋ streaming_chunk の SSE 録画）へ残ることを固定する。
// 永続化は waitUntil で走るので、ctx に渡した promise を全部回収してから検証する。

const AUTH_TOKEN = "test-auth-token";

const REPLY =
  "<response><action>窓辺に寄りかかって、こちらを振り返った。夕日が横顔を染めて、睫毛の影が頬に落ちとる。「おかえり」って、いつもより少し柔らかい声で言うた。</action><dialogue>「おかえり。待っとったで」</dialogue><inner>やっと帰ってきた。</inner></response>";

type ChunkRow = {
  stream_id: string;
  seq: number;
  raw_data: string;
  is_done: number;
  user_id: string | null;
};

const makeRecordingD1 = () => {
  const chunks: ChunkRow[] = [];
  const sqlLog: { sql: string; binds: unknown[] }[] = [];

  const handle = (sql: string, binds: unknown[]) => {
    sqlLog.push({ sql, binds });
    if (sql.startsWith("INSERT OR IGNORE INTO streaming_chunk")) {
      const [stream_id, seq, raw_data, is_done, user_id] = binds as [
        string,
        number,
        string,
        number,
        string | null,
      ];
      if (!chunks.some((row) => row.stream_id === stream_id && row.seq === seq)) {
        chunks.push({ stream_id, seq, raw_data, is_done, user_id });
      }
      return;
    }
    if (sql.startsWith("UPDATE streaming_chunk SET is_done")) {
      const [stream_id, seq] = binds as [string, number];
      const row = chunks.find((c) => c.stream_id === stream_id && c.seq === seq);
      if (row) row.is_done = 1;
    }
  };

  return {
    chunks,
    sqlLog,
    prepare: (sql: string) => {
      const stmt = {
        run: (binds: unknown[] = []) => {
          handle(sql, binds);
          return Promise.resolve({ success: true, meta: { changes: 1 }, results: [] });
        },
        all: <T = unknown>(binds: unknown[] = []) => {
          handle(sql, binds);
          if (sql.includes("FROM streaming_chunk")) {
            const [streamId, userId] = binds as [string, string];
            const results = chunks
              .filter(
                (row) =>
                  row.stream_id === streamId && (row.user_id === userId || row.user_id === null),
              )
              .sort((a, b) => a.seq - b.seq)
              .map((row) => ({ raw_data: row.raw_data, seq: row.seq, is_done: row.is_done }));
            return Promise.resolve({ results: results as T[], success: true });
          }
          // persistCompletedChatTurn の conversation 検索だけは行を返す。
          if (/from\s+["'`]?conversation["'`]?/i.test(sql) && !sql.includes("conversation_scene")) {
            return Promise.resolve({
              results: [{ character_id: "char-1", characterId: "char-1" }] as T[],
              success: true,
            });
          }
          // message INSERT ... RETURNING は入った行を返す。
          if (/into\s+["'`]?message["'`]?\s/i.test(sql)) {
            return Promise.resolve({ results: [{ id: binds[0] }] as T[], success: true });
          }
          return Promise.resolve({ results: [] as T[], success: true });
        },
        first: <T = unknown>() => Promise.resolve(null as T | null),
        // drizzle の select は .all() やのうて .raw()（位置配列）を叩く。
        raw: <T = unknown[]>(binds: unknown[] = []) => {
          handle(sql, binds);
          if (/from\s+["'`]?conversation["'`]?/i.test(sql) && !sql.includes("conversation_scene")) {
            return Promise.resolve([["char-1"]] as T[]);
          }
          return Promise.resolve([] as T[]);
        },
      };
      return {
        bind: (...binds: unknown[]) => ({
          run: () => stmt.run(binds),
          all: <T = unknown>() => stmt.all<T>(binds),
          first: <T = unknown>() => stmt.first<T>(),
          raw: <T = unknown[]>() => stmt.raw<T>(binds),
        }),
        // 実 D1 は bind なしで直接実行できる（DELETE など）。
        run: () => stmt.run(),
        all: <T = unknown>() => stmt.all<T>(),
        first: <T = unknown>() => stmt.first<T>(),
        raw: <T = unknown[]>() => stmt.raw<T>(),
      };
    },
    batch: (stmts: { run: () => Promise<unknown> }[]) =>
      Promise.all(stmts.map((stmt) => stmt.run())),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
};

const makeExecutionCtx = () => {
  const pending: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    waitUntil: (promise: Promise<unknown>): void => {
      pending.push(Promise.resolve(promise).catch(() => undefined));
    },
    passThroughOnException: (): void => undefined,
    props: {},
  };
  return { ctx, flush: () => Promise.all(pending) };
};

const stubUpstream = (replies: (() => Response)[]) => {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      const bodyText = String(init?.body ?? "");
      if (!bodyText.includes('"stream":true')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const make = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return make();
    }),
  );
};

const sseReply = (text: string): Response => {
  const encoder = new TextEncoder();
  const lines = text
    .split("")
    .map((char) => `data: {"choices":[{"delta":{"content":${JSON.stringify(char)}}}]}\n\n`)
    .join("");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const callChat = async (
  db: ReturnType<typeof makeRecordingD1>,
  headers: Record<string, string>,
) => {
  const { ctx, flush } = makeExecutionCtx();
  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "ただいま" }],
        responseLength: "medium",
        scenePhase: "conversation",
      }),
    },
    {
      AUTH_TOKEN,
      OPENROUTER_API_KEY: "test-openrouter-key",
      DB: db,
      DAILY_REQUEST_LIMIT: "100000",
      MONTHLY_COST_LIMIT_CENTS: "100000",
      TEST_NO_FALLBACK: "1",
      TEST_DISABLE_REFUSAL_RECOVERY: "1",
    },
    ctx,
  );
  const body = await response.text();
  await flush();
  return { response, body };
};

describe("バックグラウンド受け取り: 完走したターンはサーバ側で D1 に残る", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("user と assistant の行が idempotent に書かれ、SSE 録画は末尾が is_done になる", async () => {
    stubUpstream([() => sseReply(REPLY)]);
    const db = makeRecordingD1();

    const { response } = await callChat(db, {
      "x-conversation-id": "conv-1",
      "x-assistant-message-id": "assistant-1",
      "x-user-message-id": "user-1",
    });

    expect(response.status).toBe(200);

    const messageInserts = db.sqlLog.filter(({ sql }) => /into\s+["'`]?message["'`]?\s/i.test(sql));
    const insertedIds = messageInserts.map(({ binds }) => binds[0]);
    expect(insertedIds).toContain("user-1");
    expect(insertedIds).toContain("assistant-1");

    expect(db.chunks.length).toBeGreaterThan(0);
    expect(db.chunks.every((row) => row.stream_id === "assistant-1")).toBe(true);
    const last = db.chunks.reduce((a, b) => (a.seq > b.seq ? a : b));
    expect(last.is_done).toBe(1);
  });

  it("GET /chat/stream が録画をそのまま再生する", async () => {
    stubUpstream([() => sseReply(REPLY)]);
    const db = makeRecordingD1();

    const { body: sseBody } = await callChat(db, {
      "x-conversation-id": "conv-1",
      "x-assistant-message-id": "assistant-1",
      "x-user-message-id": "user-1",
    });

    const replay = await app.request(
      "/api/chat/stream?messageId=assistant-1",
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
      {
        AUTH_TOKEN,
        OPENROUTER_API_KEY: "test-openrouter-key",
        DB: db,
      },
      makeExecutionCtx().ctx,
    );

    expect(replay.status).toBe(200);
    const replayed = await replay.text();
    expect(replayed.length).toBeGreaterThan(0);
    // 録画は配信そのものの写しなので、live 配信と同一フレーム列が返る。
    expect(replayed).toBe(sseBody);
  });

  it("assistantMessageId の無い旧クライアントでは復帰用の書き込みを走らせない", async () => {
    stubUpstream([() => sseReply(REPLY)]);
    const db = makeRecordingD1();

    const { response } = await callChat(db, {});

    expect(response.status).toBe(200);
    expect(db.chunks).toHaveLength(0);
    const messageInserts = db.sqlLog.filter(({ sql }) => /into\s+["'`]?message["'`]?\s/i.test(sql));
    expect(messageInserts).toHaveLength(0);
  });
});
