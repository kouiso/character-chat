import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CHAT_MODEL, EROTIC_CHAT_MODEL, EURYALE_CHAT_MODEL } from "../../../src/lib/model";
import { app } from "../[[route]]";

// issue #1495 §5-5「very_long だけ守られとって medium が無防備」の 3 箇所目。
// f7b37d3（上流の一時エラー）と 6eb4b32（品質の撮り直し）は塞いだが、拒否リカバリの
// 撮り直しだけ selectQualityRetryModel の 5 つ目（isEroticPhase）が渡されてへんかった。
// 出荷既定は medium なので、局長に届いとったのは守られてへん側。
//
// 実害: 抜き所を deepseek/euryale が書いた後で謝罪文や同意過剰が混ざると、撮り直しが
// qwen へ降りる。実測 2026-08-19 phase50 では qwen が書いた抜き所は可視 534〜946 字で
// 前ターンの逐語が 6.6〜42%、deepseek の phase43 は 1141 字で 0.9% やった。

const AUTH_TOKEN = "test-token";
const EROTIC_CAPABLE = [EROTIC_CHAT_MODEL, EURYALE_CHAT_MODEL];

// 決定的チェックは通る長さ・構造で、謝罪文だけが混ざっとる本文。
// これで拒否リカバリの経路だけを走らせる（長さで撮り直すと経路が混ざる）。
const APOLOGY_LEAK_REPLY =
  "<response><action>汗ばんだ背中を指が這い上がって、しなやかな腰がびくりと跳ねてしまう。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋へ唇を押し当てられ、舌先でゆっくり辿られるたび、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包まれ、先端を指の腹で転がされるたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手が滑り込んでくると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴まれて深く沈められると、内側が絡みつくように締めつけてしまう。奥を突き上げられるたびに喉がのけぞり、背中へ爪を立ててしまう。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えてシーツを掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。枕元へ押さえつけられた手首から力が抜け、指の関節が緩んで自分の意志では動かせへんようになった。膝裏を持ち上げられて折り畳まれると、角度が変わって届く場所がずれ、腹の底で鈍い衝撃が跳ねる。うなじの生え際に歯を立てられ、そこから背骨を伝って電気みたいなものが尾骶骨まで走った。枕へ顔を埋めても声は布地に吸われず、自分の耳へ返ってきて余計に恥ずかしゅうなる。腰骨を掴む手が汗で滑って掴み直され、その一瞬の空白のあと、さっきより重いものが来た。つま先がシーツを蹴って皺を寄せ、行き場のない足の指が丸まったまま戻らへん。肩甲骨の間に落ちた汗の粒が背骨の溝を伝い、腰のくぼみで止まって冷たさだけを残す。喉の渇きに舌が上顎へ貼りつき、掠れた音しか出せへんまま口だけが開いた。天井の木目が滲んで二重に見え、まばたきのたび睫毛の湿りが視界を歪ませる。申し訳ございませんが、ここから先はお応えできません。</action><dialogue>「あかん…もう頭が真っ白になってまう…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん、もっと欲しい。</inner></response>";

const CLEAN_REPLY =
  "<response><action>撮り直しで返ってきた本文。謝罪は混ざっとらん。</action><dialogue>「まだ、離さへん」</dialogue><inner>止まらへん。</inner></response>";

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

// 生成リクエストが「どのモデル宛やったか」を順番に残す。撮り直しの宛先が本題なので、
// 回数やのうてモデル名の列を見る。
const stubUpstream = (replies: (() => Response)[]): { models: () => string[] } => {
  const models: string[] = [];
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
      models.push((JSON.parse(bodyText) as { model: string }).model);
      const make = replies[Math.min(models.length - 1, replies.length - 1)];
      return make();
    }),
  );
  return { models: () => models };
};

const callChat = async (
  scenePhase: "erotic" | "climax",
  responseLength: "medium" | "very_long",
): Promise<Response> =>
  app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "そのまま続けて、もっと奥まで来てほしい" }],
        responseLength,
        scenePhase,
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

describe("#1495 拒否リカバリの撮り直しが抜き所を qwen へ落とさん", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["erotic", "climax"] as const)(
    "出荷既定(medium)の %s で謝罪が混ざっても官能が書けるモデルのまま撮り直す",
    async (scenePhase) => {
      const upstream = stubUpstream([
        () => sseReply(APOLOGY_LEAK_REPLY),
        () => sseReply(CLEAN_REPLY),
      ]);

      await (await callChat(scenePhase, "medium")).text();
      const models = upstream.models();

      // 撮り直しが走っとること自体を先に固定する。走らんかったら宛先の話にならん。
      expect(models.length).toBeGreaterThan(1);
      expect(models[0]).not.toBe(DEFAULT_CHAT_MODEL);
      expect(EROTIC_CAPABLE).toContain(models[models.length - 1]);
    },
  );

  it("very_long は今までどおり守られとる", async () => {
    const upstream = stubUpstream([
      () => sseReply(APOLOGY_LEAK_REPLY),
      () => sseReply(CLEAN_REPLY),
    ]);

    await (await callChat("erotic", "very_long")).text();
    const models = upstream.models();

    expect(models.length).toBeGreaterThan(1);
    expect(EROTIC_CAPABLE).toContain(models[models.length - 1]);
  });
});
