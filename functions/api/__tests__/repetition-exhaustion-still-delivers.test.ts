import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// repetition のリトライを焼き切った時の出口。二つの要求が両立せなあかん。
//
// (1) 吹き出しを消さん。{ok:false} を返すと 502 になり、ou-app は空の吹き出しを消したうえで
//     「ユーザー自身の発言」を未送達に落とす。届いとるのに自分の送信が失敗したように見える
//     （2026-08-16 の 18 ターン通しで実測 2 回）。
// (2) 直前ターンと一字一句同じ本文を進んで選ばん。選ぶと同じ返事が履歴に 2 つ並び、
//     次ターン以降のループが固定される（敵対レビュー 2026-08-16 が実ハンドラで再現）。
//
// 上流が同一テキストしか返さん病的な場合は (1) が勝つ。ここはその最悪ケースを固定する。

const AUTH_TOKEN = "test-token";

const LONG_EROTIC_REPLY =
  "<response><action>汗ばんだ背中へ指を這わせると、しなやかな腰がびくりと跳ねた。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てて舌先でゆっくり辿れば、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包み、先端を指の腹で転がすたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手を滑らせると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴んで深く沈み込ませれば、内側が絡みつくように締めつけてきた。奥を突き上げるたびに白い喉がのけぞり、背中へ爪が食い込む。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えて布地を掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。腰が勝手に迎えにいって、根元まで飲み込んだ瞬間、爪先までぴんと張り詰めた。指を絡めて握り返されると、胸の奥がぎゅうっと締めつけられて、涙が滲む。</action><dialogue>「あかん…そこ擦れるたびに頭が溶けてまう…もっと奥まで来て、全部ちょうだい…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん。突かれるたびに何もかもほどけて、この人のかたちだけが残る。恥ずかしいのに、欲しいて仕方ない。</inner></response>";

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
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const stubUpstream = (replies: (() => Response)[]): void => {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      const make = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return make();
    }),
  );
};

const collectClientVisibleText = (sse: string): string => {
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
      // ignore
    }
  }
  return text;
};

describe("adversarial: repetition-exhausted unconditional delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers an EXACT duplicate of the immediately preceding assistant turn when upstream never varies", async () => {
    // 上流は毎回まったく同じテキストを返す＝near-duplicate/cross-turn-repetitionに
    // 必ず引っかかる。旧コードなら ok:false で本文を出さない経路。
    stubUpstream([() => sseReply(LONG_EROTIC_REPLY)]);

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
            { role: "user", content: "はじめまして" },
            // 直前ターンとして既にこの本文が履歴に入っている状態を再現する
            { role: "assistant", content: LONG_EROTIC_REPLY },
            { role: "user", content: "もっと続けて" },
          ],
          responseLength: "short",
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
        // TURN_GENERATION_HARD_CAP(=3 attempts)より先にmaxRetriesで自然終了させ、
        // repetitionカテゴリ専用のpost-loop fallback（claim 5の対象コード）を確実に踏む。
        MAX_QUALITY_RETRIES: "1",
      },
      makeExecutionCtx(),
    );

    const body = await response.text();
    const text = collectClientVisibleText(body);

    console.log("status", response.status);
    console.log("delivered text equals prior turn exactly:", text === LONG_EROTIC_REPLY);
    console.log("delivered length", text.length);

    // 主張への反証: 本文が配信され、しかも直前ターンと一字一句同一。
    // これが履歴へ積まれれば、同一本文が2ターン連続で並ぶ = ループへの固定そのもの。
    expect(text.length).toBeGreaterThan(0);
    // 全 attempt が直前ターンと同一になる病的な場合は、それでも配る。
    // ここで {ok:false} を返すと 502 になり、ou-app は空の吹き出しを消したうえで
    // ユーザー自身の発言まで未送達に落とす（実測 18ターン中 2回）。
    expect(text).toBe(LONG_EROTIC_REPLY);
  });
});
