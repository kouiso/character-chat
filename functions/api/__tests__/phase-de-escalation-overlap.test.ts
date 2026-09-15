import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// #946: 曖昧語の問い直し(LLM1本)は1文字目より前に挟まる。これが記憶読み込みの後ろに
// 直列で積まれると、その待ち時間がまるごと1文字目へ乗る。実ハンドラを動かして
// 「問い直しを投げるターン」と「投げんターン」の実時間差を測り、積み上がっとらんことを固定する。
// 呼ばれたかどうかだけを見ても、直列か並行かは区別できん。

const AUTH_TOKEN = "test-token";
const CHARACTER_ID = "char-1";

// D1 の1問い合わせあたりの遅延。問い直しの前に走る
// validateCharacterOwnership / fetchCharacterForConversation / fetchRecentMemoryNotes の
// 3本ぶんが並行の窓になる。
const DB_DELAY_MS = 300;
// 窓(900ms)より短くしとく。並行なら窓に隠れて実時間差はほぼ0、直列ならそのまま乗る。
const CLASSIFIER_DELAY_MS = 800;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const LONG_EROTIC_REPLY =
  "<response><action>汗ばんだ背中へ指を這わせると、しなやかな腰がびくりと跳ねた。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てて舌先でゆっくり辿れば、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包み、先端を指の腹で転がすたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手を滑らせると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴んで深く沈み込ませれば、内側が絡みつくように締めつけてきた。奥を突き上げるたびに白い喉がのけぞり、背中へ爪が食い込む。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えて布地を掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。腰が勝手に迎えにいって、根元まで飲み込んだ瞬間、爪先までぴんと張り詰めた。指を絡めて握り返されると、胸の奥がぎゅうっと締めつけられて、涙が滲む。</action><dialogue>「あかん…そこ擦れるたびに頭が溶けてまう…もっと奥まで来て、全部ちょうだい…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん。突かれるたびに何もかもほどけて、この人のかたちだけが残る。</inner></response>";

// select は SQL を見て返す形を変える。キャラの所有確認だけ1行返さんと 404 で
// 記憶読み込みまで届かず、並行の窓そのものが消える。
const makeSlowD1Mock = () => ({
  prepare: (sql: string) => ({
    bind: () => ({
      run: async () => {
        await sleep(DB_DELAY_MS);
        return { success: true, meta: { changes: 0 }, results: [] };
      },
      all: async () => {
        await sleep(DB_DELAY_MS);
        const isCharacterSelect = /\bcharacter\b/i.test(sql) && !/memory/i.test(sql);
        return {
          success: true,
          results: isCharacterSelect ? [{ id: CHARACTER_ID, name: "さくら" }] : [],
          meta: {},
        };
      },
      first: async () => {
        await sleep(DB_DELAY_MS);
        return null;
      },
      raw: async () => [],
    }),
  }),
  // レート制限は問い直しより前に走るので、遅延を入れると測りたい窓の外で
  // 両方のリクエストに同じ下駄を履かせるだけになる。素通しにする。
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

const isClassifierCall = (init?: RequestInit): boolean => {
  const headers = new Headers(init?.headers);
  return (headers.get("X-Title") ?? "").includes("Classifier");
};

// 問い直しだけを遅らせる。生成側は即答させて、測るのが問い直しぶんだけになるようにする。
const stubUpstream = (): { classifierCalls: () => number } => {
  let classifierCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (isClassifierCall(init)) {
        classifierCalls += 1;
        await sleep(CLASSIFIER_DELAY_MS);
        // 降格させん答え。両リクエストの後段フェーズを climax で揃えて、
        // 測る差が問い直しの待ち時間だけになるようにする。
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"ordinary_language":false,"reason":"climax utterance"}' } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return sseReply(LONG_EROTIC_REPLY);
    }),
  );
  return { classifierCalls: () => classifierCalls };
};

// 直前ターンでエロ段階に入っとる会話。曖昧語はこの段階でだけ絶頂として効く。
const eroticSceneSoFar = [
  { role: "user", content: "挿入して" },
  { role: "assistant", content: "……うん" },
];

const callChat = async (latestUserMessage: string): Promise<Response> =>
  app.request(
    "/api/chat",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [...eroticSceneSoFar, { role: "user", content: latestUserMessage }],
        responseLength: "medium",
        characterId: CHARACTER_ID,
      }),
    },
    {
      AUTH_TOKEN,
      OPENROUTER_API_KEY: "test-openrouter-key",
      DB: makeSlowD1Mock(),
      DAILY_REQUEST_LIMIT: "100000",
      MONTHLY_COST_LIMIT_CENTS: "100000",
      TEST_NO_FALLBACK: "1",
    },
    makeExecutionCtx(),
  );

const timeChat = async (latestUserMessage: string): Promise<number> => {
  const startedAt = Date.now();
  const response = await callChat(latestUserMessage);
  await response.text();
  return Date.now() - startedAt;
};

describe("#946 曖昧語の問い直しは記憶読み込みと並行に走る", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("問い直しの待ち時間が記憶読み込みへ積み上がらん", async () => {
    const withoutReAsk = stubUpstream();
    // 「もうイッちゃう」は曖昧語やないので問い直し自体が走らん。これが基準線。
    const baselineMs = await timeChat("もうイッちゃう");
    expect(withoutReAsk.classifierCalls()).toBe(0);
    vi.unstubAllGlobals();

    const withReAsk = stubUpstream();
    // 「元気出して」は曖昧語1個で climax が立つターン。問い直しが走る。
    const reAskMs = await timeChat("元気出して");
    expect(withReAsk.classifierCalls()).toBe(1);

    const addedMs = reAskMs - baselineMs;
    // 直列やと CLASSIFIER_DELAY_MS(800ms) がまるごと乗る。並行なら
    // D1 の窓(300ms×3)に隠れてほとんど乗らん。半分を境にする。
    expect(addedMs).toBeLessThan(CLASSIFIER_DELAY_MS / 2);
  }, 30000);
});
