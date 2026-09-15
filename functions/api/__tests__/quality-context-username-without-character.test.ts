import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// 敵対レビュー #1236 指摘・9巡目: characterId 無しで /api/chat を呼ぶと
// overrideUserPersonaMessage(キャラ単体分岐の中)が走らず、qualityContext.userName
// （checkNoEnglishの登録名除外に使う）が未設定のまま残っていた。userNameGuardは
// アカウント表示名（ローマ字を含みうる）をキャラへ呼び方として指示しているため、
// その指示どおりの正しい応答が英語混入と誤判定されて不要な再生成に入っていた。
// 実ハンドラでOpenRouterへの実際の呼び出し回数を見て確認する。

const AUTH_TOKEN = "test-token";

const makeAccountD1Mock = (displayName: string | null) => ({
  prepare: (sql: string) => ({
    bind: () => {
      const isUserTable = sql.includes('"user"');
      const rows = isUserTable && sql.startsWith("select") ? [{ displayName }] : [];
      return {
        run: () => Promise.resolve({ success: true, meta: { changes: 0 }, results: [] }),
        all: () => Promise.resolve({ success: true, results: rows, meta: {} }),
        first: () => Promise.resolve(rows[0] ?? null),
        raw: () => Promise.resolve(rows.map((row) => Object.values(row))),
      };
    },
  }),
  batch: (stmts: unknown[]) =>
    Promise.resolve(stmts.map(() => ({ success: true, meta: { changes: 1 }, results: [] }))),
  dump: () => Promise.resolve(new ArrayBuffer(0)),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
});

const makeExecutionCtx = (): ExecutionContext => ({
  waitUntil: (promise: Promise<unknown>): void => {
    void Promise.resolve(promise).catch(() => undefined);
  },
  passThroughOnException: (): void => undefined,
  props: {},
});

const sseReply = (text: string): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
      controller.enqueue(encoder.encode(frame));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const ALICE_REPLY =
  "<response><action>湯呑みを差し出して、隣に腰を下ろした。畳の匂いと湯気がゆっくり広がっていく。</action><dialogue>「Aliceは今日、疲れとらん?ゆっくりしていき」</dialogue><inner>この静かな時間が、たまらなく好きや。</inner></response>";

describe("characterId 無しでもアカウント表示名がqualityContext.userNameへ伝わる", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ローマ字のアカウント表示名を呼びかけに使った正しい応答が、no-englishで不要な再生成に入らない", async () => {
    let chatGenerationCalls = 0;
    // 会話フェーズの婉曲な誘い判定(subtext-escalation-classifier)は本題(#1236 9巡目)とは
    // 無関係な別のOpenRouter呼び出しで、SSEではなく非ストリームJSONの応答を期待している。
    // これをSSEで応答するとパース失敗でフォールバックモデルへ何度も再試行し、本題の
    // 生成呼び出し回数を数えづらくする。判定系には妥当なJSONを即答して素通りさせ、
    // 実際のチャット生成呼び出し（lengthDirectiveを積んだ本文）だけを数える。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (!url.includes("openrouter.ai")) {
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const body = String(init?.body ?? "{}");
        if (!body.includes("【応答長さ最終指示】")) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: '{"escalate":false}' } }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        chatGenerationCalls += 1;
        return sseReply(ALICE_REPLY);
      }),
    );

    const response = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // characterId をあえて省略する（本Issueの再現条件）
          messages: [{ role: "user", content: "今日あったこと聞いて" }],
          responseLength: "medium",
          scenePhase: "conversation",
        }),
      },
      {
        AUTH_TOKEN,
        OPENROUTER_API_KEY: "test-openrouter-key",
        DB: makeAccountD1Mock("Alice"),
        DAILY_REQUEST_LIMIT: "100000",
        MONTHLY_COST_LIMIT_CENTS: "100000",
        TEST_NO_FALLBACK: "1",
      },
      makeExecutionCtx(),
    );

    expect(response.status).toBe(200);
    await response.text();

    expect(chatGenerationCalls).toBe(1);
  });
});
