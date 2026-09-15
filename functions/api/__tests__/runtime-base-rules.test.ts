import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAT_BASE_RULES } from "../../../src/lib/prompt-builder";
import { app } from "../[[route]]";

// #907: 会話品質ルールは保存済み system_prompt への焼き込みではなく実行時に付ける。
// 実ハンドラが OpenRouter へ送る body を捕捉し、(1) 焼き込みが無くてもルールが届く
// (2) 焼き込み済みでも二重にならない、を実経路で検証する。

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

const captureOpenRouterFetch = () => {
  const captured: { messages: Array<{ role: string; content: string }> }[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openrouter.ai")) {
      captured.push(JSON.parse(String(init?.body ?? "{}")));
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

const CHARACTER_BODY = [
  "【キャラクター】",
  "名前: みつき",
  "ツンデレのバーテンダー",
  "",
  "【シナリオ】",
  "閉店後のバーで二人きり",
].join("\n");

const callChat = async (
  characterSystemPrompt: string,
  captured: { messages: Array<{ role: string; content: string }> }[],
) => {
  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: characterSystemPrompt },
          { role: "user", content: "こんばんは、今日はどんな一日やった？" },
        ],
        responseLength: "medium",
        scenePhase: "erotic",
      }),
    },
    {
      AUTH_TOKEN,
      OPENROUTER_API_KEY: "test-openrouter-key",
      DB: makeD1Mock(),
      DAILY_REQUEST_LIMIT: "100000",
      MONTHLY_COST_LIMIT_CENTS: "100000",
    },
  );

  expect(response.status).toBe(402);
  expect(captured.length).toBeGreaterThan(0);
  return captured[0].messages.map((m) => m.content).join("\n");
};

const countRuleHeads = (text: string): number => text.split("[ABSOLUTE LANGUAGE RULE").length - 1;

describe("#907 会話品質ルールの実行時付与（実 /api/chat 経路）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("焼き込みの無いキャラでもルールが送信される", async () => {
    const captured = captureOpenRouterFetch();
    const sent = await callChat(CHARACTER_BODY, captured);

    expect(sent).toContain("ABSOLUTE LANGUAGE RULE");
    expect(sent).toContain("[SAYLO-STYLE STRUCTURE");
    expect(sent).toContain("名前: みつき");
    expect(countRuleHeads(sent)).toBe(1);
  });

  it("焼き込み済みキャラでもルールは1回しか送信されない", async () => {
    const captured = captureOpenRouterFetch();
    const sent = await callChat(`${CHAT_BASE_RULES}\n${CHARACTER_BODY}`, captured);

    expect(countRuleHeads(sent)).toBe(1);
    expect(sent).toContain("名前: みつき");
    expect(sent).toContain("閉店後のバーで二人きり");
  });

  it("焼き込みの有無で送信内容が一致する（同一キャラの前後比較）", async () => {
    const capturedWithout = captureOpenRouterFetch();
    const withoutBake = await callChat(CHARACTER_BODY, capturedWithout);
    vi.unstubAllGlobals();

    const capturedWith = captureOpenRouterFetch();
    const withBake = await callChat(`${CHAT_BASE_RULES}\n${CHARACTER_BODY}`, capturedWith);

    expect(withBake).toBe(withoutBake);
  });
});
