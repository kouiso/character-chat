import { afterEach, describe, expect, it, vi } from "vitest";

import { runQualityChecks } from "../../../src/lib/quality-guard";
import { app } from "../[[route]]";

import type { QualityCheckContext } from "../../../src/lib/quality-guard";

// #1470: runQualityChecks は列の先頭で落ちた 1 個で打ち切っとった。撮り直しは 1 ターンに
// 1 回しか無いので、先に落ちた検出器がその 1 回を食うと、後ろの検出器は直る機会が
// 一度も来ん（実測 538 ターン中 6 件、呼びかけ連投が飢えとった）。
// 撮り直しの本数は据え置きのまま、1 回の撮り直しが知る量だけを増やす。

const AUTH_TOKEN = "test-token";

// 英語混入（列の 10 番目）と呼びかけ連投（列の 26 番目）が同時に落ちる本文。
// <dialogue> は 1 ブロック 1 行なので dialogue-wall には当たらん。
const TWO_FAILURE_REPLY = [
  "<response>",
  "<action>窓際で足を止めて、湯気の立つcoffeeのカップを両手で包んだ。</action>",
  "<dialogue>「あなた…、こっち向いて」</dialogue>",
  "<action>指先で袖口をつまんで、そっと引き寄せる。</action>",
  "<dialogue>「あなた…、聞こえてる？」</dialogue>",
  "<action>言葉を探すみたいに視線が泳いだ。</action>",
  "<dialogue>「あなた…、ねえ」</dialogue>",
  "<inner>心臓の音がうるさい。</inner>",
  "</response>",
].join("");

const CLEAN_REPLY = [
  "<response>",
  "<action>湯気の立つカップを両手で包んで、窓の外の雨をぼんやり眺めた。</action>",
  "<dialogue>「今日はもう帰らへんのやろ。だったら座って」</dialogue>",
  "<inner>胸の奥がざわついて、うまく言葉にならへん。</inner>",
  "</response>",
].join("");

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
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

interface UpstreamRequestBody {
  messages: { role: string; content: string }[];
}

const isJudgeRequest = (body: UpstreamRequestBody): boolean =>
  body.messages.some((message) => message.content.includes("strict judge"));

const stubUpstream = (replies: string[]): UpstreamRequestBody[] => {
  const captured: UpstreamRequestBody[] = [];
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as UpstreamRequestBody;
      // 採点役(judge)も同じ OpenRouter を叩く。撮り直しの本文と混ぜんよう分ける。
      if (isJudgeRequest(body)) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "PASS" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      captured.push(body);
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return sseReply(reply);
    }),
  );
  return captured;
};

const callChat = async (): Promise<Response> =>
  app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "隣に座って、今日あったこと聞かせて" }],
        responseLength: "short",
        scenePhase: "conversation",
      }),
    },
    {
      AUTH_TOKEN,
      OPENROUTER_API_KEY: "test-openrouter-key",
      DB: makeD1Mock(),
      DAILY_REQUEST_LIMIT: "100000",
      MONTHLY_COST_LIMIT_CENTS: "100000",
      TEST_NO_FALLBACK: "1",
      MAX_QUALITY_RETRIES: "1",
    },
    makeExecutionCtx(),
  );

describe("#1470 同じターンで落ちた検出器を全部 1 回の撮り直しへ渡す", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runQualityChecks が 2 個とも報告する（先頭 1 個で打ち切らん）", () => {
    const context: QualityCheckContext = { phase: "conversation", characterName: "桜庭さくら" };

    const result = runQualityChecks(TWO_FAILURE_REPLY, context);

    expect(result.passed).toBe(false);
    const failedChecks = result.failures?.map((failure) => failure.failedCheck) ?? [];
    expect(failedChecks).toContain("no-english");
    expect(failedChecks).toContain("within-turn-vocative-lead");
    // 既存の呼び出し元が読む先頭の 1 個は、列の優先度どおりのまま変わらん。
    expect(result.failedCheck).toBe("no-english");
    expect(result.category).toBe("english_leak");
  });

  it("1 回だけの撮り直しへ 2 個ともヒントが載る", async () => {
    const captured = stubUpstream([TWO_FAILURE_REPLY, CLEAN_REPLY]);

    const response = await callChat();
    await response.text();

    expect(captured.length).toBeGreaterThanOrEqual(2);
    const retryPrompt = captured[1].messages.at(-1)?.content ?? "";
    // english_leak（先頭で落ちた側）のヒント
    expect(retryPrompt).toContain("日本語だけで書き直してください");
    // repetition（呼びかけ連投）のヒント。これが欠けとるのが #1470 の症状。
    expect(retryPrompt).toContain("反復している語句");
    expect(retryPrompt).toContain("within-turn-vocative-lead");
  });
});
