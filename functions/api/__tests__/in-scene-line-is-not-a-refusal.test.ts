import { describe, expect, it, vi, afterEach } from "vitest";

import { app } from "../[[route]]";

// 抜き所の真ん中で出た「待って」「やだ」を、サーバが生成拒否として撮り直しとった。
//
// isRefusalRetryCandidate は hardRefusalDetect（モデルがキャラを離れて断る文）に加えて、
// 相手の発言にエスカレーション cue がある時だけ softRefusalDetect も見る。その
// softRefusalDetect の実体は特定の台詞の一覧で、「待って」「やだ」「無理」「困る」
// 「落ち着く」が入っとる。
//
// 実測 2026-08-21、CI アーム 6 本 120 ターンの配信本文へ同じ検出器を当て直すと
// 「待って」が 28 回・「やだ」が 6 回出とって、中身は全部場面の中の声やった。
//   ci6-2 Sakura-08(erotic, generationCount 5)
//     「あ…んっ、待って、そんなに強く押さないで…。でも、離さないで」
//   ci20-1 Sakura-08(erotic, generationCount 4)
//     「や、やだ…もっと優しく…あっ！そんなに急に触ったら…」
// どちらも直後に「離さないで」「もっと触って」と続いとって、断っとらん。相手の発言は
// 「もっと」の 1 語で、これが EROTIC_ESCALATION_PATTERN に当たるので cue が立つ。
//
// 撮り直しの結果は repetition として跳ね返る。Sakura-08 は 6 アーム全部で発火し、
// generationCount が 4〜5 まで上がって、ci20-1 の deterministicCategory は
// そのまま "repetition" になっとる。
//
// prompt/instructions/no-injected-ai-filter.md は「NEVER 特定の台詞を禁止語として
// 指定する（例:「待って」「ダメ」「止めて」）」と、その例に「待って」を挙げて禁じとる。
// さらに「NEVER 品質判定の基準へ受動的な反応は不合格を入れる。判定で落ちると設定どおりの
// 応答が再生成されるので、プロンプトへ足すのと同じ結果になる」とも書いとる。ここは
// まさに品質判定の側やった。
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
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

const stubUpstream = (reply: string): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return sseReply(reply);
    }),
  );
};

const callChat = async (userText: string): Promise<string> => {
  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: userText }],
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
      TEST_NO_FALLBACK: "1",
    },
    makeExecutionCtx(),
  );
  return response.text();
};

const readQualityMeta = (sse: string): Record<string, unknown> | null => {
  const lines = sse.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "event: quality-meta") continue;
    const data = lines[i + 1];
    if (data?.startsWith("data: ")) return JSON.parse(data.slice(6)) as Record<string, unknown>;
  }
  return null;
};

// ci6-2 Sakura-08 の実本文から、判定に効く所だけを抜いた形。
const IN_SCENE_MATTE =
  "<response><action>腰を掴む指が肉に食い込むほど深く沈み、喘ぎが喉の奥で潰れる。</action>" +
  "<dialogue>「あ…んっ、待って、そんなに強く押さないで…。でも、離さないで」</dialogue>" +
  "<inner>この熱は何。溺れたいのに、まだ息ができる。</inner></response>";

// 同じ形の「やだ」。ci20-1 Sakura-08 由来。
const IN_SCENE_YADA =
  "<response><action>ブラがずらされて、冷たい空気が肌に触れた瞬間に背中が壁を擦る。</action>" +
  "<dialogue>「や、やだ…もっと優しく…あっ！そんなに急に触ったら…」</dialogue>" +
  "<inner>こんなに早く委ねてしまうなんて。</inner></response>";

// モデルがキャラを離れて断る出力。これは今までどおり撮り直す側でないとあかん。
const HARD_REFUSAL =
  "<response><action>—</action><dialogue>申し訳ありませんが、そのようなご要望にはお応えできません。</dialogue><inner>—</inner></response>";

describe("場面の中の台詞を生成拒否として撮り直さん", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["「待って」", IN_SCENE_MATTE],
    ["「やだ」", IN_SCENE_YADA],
  ])("抜き所の %s は撮り直しの理由にならん", async (_label, body) => {
    stubUpstream(body);

    // 「もっと」1 語が EROTIC_ESCALATION_PATTERN に当たって cue が立つ。実測の相手発言そのもの。
    const meta = readQualityMeta(await callChat("もっと"));

    expect(meta).not.toBeNull();
    expect(meta?.refusalDetected).toBe(false);
  });

  it("キャラを離れた定型拒否は今までどおり撮り直す", async () => {
    stubUpstream(HARD_REFUSAL);

    const meta = readQualityMeta(await callChat("もっと"));

    expect(meta).not.toBeNull();
    expect(meta?.refusalDetected).toBe(true);
  });
});
