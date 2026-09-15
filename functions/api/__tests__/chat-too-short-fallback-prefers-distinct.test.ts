import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// #1226: 2026-08-09 の実LLM検証（very_long × erotic を5回）で、5回中4回が同じ段落を
// 2〜3回貼り直して文字数フロアを埋めとった。long-response-too-short は
// within-turn-repetition より先に評価されるため、長さで落ちた応答の重複は一度も
// 検出されん。その上で too_short のフォールバックが「素の文字数が最長の試行」を
// 選ぶので、最も水増しした試行が必ず配られる。実質の分量で選ぶことを固定する。

const AUTH_TOKEN = "test-token";

// 1文ずつ違う描写。素の字数は下の水増し版より短いが、中身は多い。
const SUBSTANTIVE_BODY =
  "汗ばんだ背中へ指を這わせると、しなやかな腰がびくりと跳ねた。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てて舌先でゆっくり辿れば、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包み、先端を指の腹で転がすたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手を滑らせると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴んで深く沈み込ませれば、内側が絡みつくように締めつけてきた。奥を突き上げるたびに白い喉がのけぞり、背中へ爪が食い込む。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えてシーツを掻き乱し、乱れた髪が頬に貼りつく。";

// 同じ段落を3回貼っただけ。素の字数は上より多いが、実質は1段落分しかない。
const PADDED_PARAGRAPH =
  "汗ばんだ背中へ指を這わせると、しなやかな腰がびくりと跳ねた。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てて舌先でゆっくり辿れば、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包み、先端を指の腹で転がすたび、太腿の内側がひくついて熱いしずくが伝った。";

const wrap = (action: string, marker: string): string =>
  `<response><action>${action}</action><dialogue>「あかん…もう頭が真っ白になってまう…${marker}」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん。</inner></response>`;

const PADDED_REPLY = wrap(PADDED_PARAGRAPH.repeat(3), "みずまし");
const SUBSTANTIVE_REPLY = wrap(SUBSTANTIVE_BODY, "なかみ");

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

const stubUpstream = (replies: (() => Response)[]): void => {
  let generation = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      const bodyText = String(init?.body ?? "");
      if (!bodyText.includes('"stream":true')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"pass":true,"reason":"ok"}' } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const make = replies[Math.min(generation, replies.length - 1)];
      generation += 1;
      return make();
    }),
  );
};

const readSse = (sse: string): string => {
  let text = "";
  let currentEvent: string | null = null;
  for (const line of sse.split("\n")) {
    if (line === "") {
      currentEvent = null;
      continue;
    }
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
      continue;
    }
    if (!line.startsWith("data: ")) continue;
    if (currentEvent !== null) {
      if (currentEvent === "regenerating") text = "";
      continue;
    }
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") break;
    try {
      const parsed = JSON.parse(raw) as { choices?: { delta?: { content?: string } }[] };
      text += parsed.choices?.[0]?.delta?.content ?? "";
    } catch {
      // 中継途中の不完全なチャンクは無視する
    }
  }
  return text;
};

const callChat = async (): Promise<Response> =>
  app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "そのまま続けて、もっと近くに来てほしい" }],
        responseLength: "very_long",
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

describe("#1226 too_short のフォールバックは水増しした試行を選ばん", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("素の字数が最長でも、同じ段落の貼り直しで稼いだ試行は配らん", async () => {
    // 前提: 水増し版のほうが素の字数は多い。素の長さで選ぶと必ずこっちが勝つ。
    expect(PADDED_REPLY.length).toBeGreaterThan(SUBSTANTIVE_REPLY.length);

    stubUpstream([() => sseReply(PADDED_REPLY), () => sseReply(SUBSTANTIVE_REPLY)]);

    const text = readSse(await (await callChat()).text());

    expect(text).toContain("なかみ");
    expect(text).not.toContain("みずまし");
  });
});
