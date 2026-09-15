import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// #1093 統合テスト: 長尺会話で /api/chat ハンドラが OpenRouter へ送信する messages 件数が
// CHAT_HISTORY_MAX_TURNS(25ターン=50件) を超えないことを、送信 body を捕捉して検証する。

const AUTH_TOKEN = "test-token";

const makeD1Mock = () => ({
  prepare: () => ({
    bind: () => ({
      run: () => Promise.resolve({ success: true, meta: { changes: 0 }, results: [] }),
      all: () => Promise.resolve({ success: true, results: [], meta: {} }),
      first: () => Promise.resolve(null),
      raw: () => Promise.resolve([]),
    }),
  }),
  batch: (stmts: unknown[]) =>
    Promise.resolve(stmts.map(() => ({ success: true, meta: { changes: 1 }, results: [] }))),
  dump: () => Promise.resolve(new ArrayBuffer(0)),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
});

const captureChatFetch = () => {
  const captured: { messages: Array<{ role: string; content: string }> }[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openrouter.ai")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.stream === true) {
        captured.push(body);
      }
      return new Response(JSON.stringify({ error: { message: "payment required" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", stub);
  return captured;
};

const buildLongConversation = (
  turns: number,
): Array<{ role: "system" | "user" | "assistant"; content: string }> => {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: "キャラ設定: サクラ。ユーザーのことは「あんた」と呼ぶ。" },
  ];
  for (let i = 0; i < turns; i += 1) {
    messages.push({ role: "user", content: `user turn ${i}` });
    if (i < turns - 1) {
      messages.push({ role: "assistant", content: `assistant response ${i}` });
    }
  }
  return messages;
};

describe("#1093 chat history turn cap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("30ターンの会話は直近25ターン(50件)に刈られる", async () => {
    const captured = captureChatFetch();
    const messages = buildLongConversation(30);
    const latestUserContent = "user turn 29";

    const response = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          responseLength: "short",
        }),
      },
      {
        AUTH_TOKEN,
        OPENROUTER_API_KEY: "test-openrouter-key",
        APP_ORIGIN: "https://ai-chat.app",
        DB: makeD1Mock(),
        DAILY_REQUEST_LIMIT: "100000",
        MONTHLY_COST_LIMIT_CENTS: "100000",
        TEST_NO_FALLBACK: "1",
      },
    );

    expect(response.status).toBe(402);
    expect(captured.length).toBeGreaterThan(0);

    const sentMessages = captured[0].messages;
    const nonSystemMessages = sentMessages.filter((m) => m.role !== "system");

    expect(nonSystemMessages.length).toBeLessThanOrEqual(50);
    expect(sentMessages.at(-1)?.role).toBe("user");
    // 末尾の長さ指示は全長さへ差し込むようになったので、完全一致では見ん
    // （このテストが押さえとるのは履歴の刈り込みであって、末尾の中身やない）。
    expect(sentMessages.at(-1)?.content).toContain(latestUserContent);
  });

  it("25ターン以下の会話はすべて残る", async () => {
    const captured = captureChatFetch();
    const messages = buildLongConversation(25);

    const response = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          responseLength: "short",
        }),
      },
      {
        AUTH_TOKEN,
        OPENROUTER_API_KEY: "test-openrouter-key",
        APP_ORIGIN: "https://ai-chat.app",
        DB: makeD1Mock(),
        DAILY_REQUEST_LIMIT: "100000",
        MONTHLY_COST_LIMIT_CENTS: "100000",
        TEST_NO_FALLBACK: "1",
      },
    );

    expect(response.status).toBe(402);
    expect(captured.length).toBeGreaterThan(0);

    const sentMessages = captured[0].messages;
    const nonSystemMessages = sentMessages.filter((m) => m.role !== "system");

    expect(nonSystemMessages.length).toBe(49);
  });
});
