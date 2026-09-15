import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// #947 のライブ中継は、作り直しが起きたことを event: regenerating でしか伝えられない。
// クライアントはこのイベントを受けた時だけ吹き出しを空へ戻すので、
// 「作り直したのに regenerating を出さない」「regenerating を出したのに何も出さない」
// のどちらも、ユーザーに見える本文を壊す。実ハンドラを動かして両方を固定する。

const AUTH_TOKEN = "test-token";

const CONSENT_REPLY =
  "<response><action>そっと肩に手を置いて、静かに微笑んだ。窓の外では夕暮れが街を橙に染めていく。指先が触れた瞬間、体温が伝わって、心臓が少しだけ速くなった。カーテンが揺れて、部屋の空気がやわらかく入れ替わる。</action><dialogue>「今日はゆっくりしていってな。無理しないで」</dialogue><inner>ずっと待っとった時間や。胸の奥があたたかい。こうして隣におるだけで、言葉が要らんくなる。</inner></response>";

const CLEAN_REPLY =
  "<response><action>湯呑みを差し出して、隣に腰を下ろした。畳の匂いと湯気がゆっくり広がっていく。膝が触れそうな距離で、あえて何も言わずに窓の外を眺めた。夕闇が濃くなって、部屋の輪郭がやわらかく溶けていく。</action><dialogue>「熱いから気ぃつけてな」</dialogue><inner>この静かな時間が、たまらなく好きや。息を吸うたびに、胸の奥がゆっくりほどけていく。</inner></response>";

// erotic の長文フロア(600字)には届かんが、他の決定的チェックは全部通る本文。
// これで lastFailureCategory が too_short になり、次の試行が上流で落ちた時の
// フォールバック(前の試行をそのまま採用)へ入る。
const SHORT_EROTIC_REPLY =
  "<response><action>熱を帯びた肌が触れ合って、指先が背中をなぞるたびに息が詰まる。汗ばんだ首筋に唇を寄せると、甘い声が漏れて、体の奥がとろけるように疼いた。腰を引き寄せられて、深く重なった瞬間、視界が白く弾ける。</action><dialogue>「もっと…あかん、止まらへん…」</dialogue><inner>頭が真っ白になって、何も考えられへん。もっと欲しい。</inner></response>";

// erotic の長文フロア(600字)を越え、決定的チェックも全部通る本文。
// これが採用されると最終差し替えが走らんので、中継済みの断片がそのまま残る。
const LONG_EROTIC_REPLY =
  "<response><action>汗ばんだ背中へ指を這わせると、しなやかな腰がびくりと跳ねた。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てて舌先でゆっくり辿れば、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包み、先端を指の腹で転がすたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手を滑らせると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴んで深く沈み込ませれば、内側が絡みつくように締めつけてきた。奥を突き上げるたびに白い喉がのけぞり、背中へ爪が食い込む。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えて布地を掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。腰が勝手に迎えにいって、根元まで飲み込んだ瞬間、爪先までぴんと張り詰めた。指を絡めて握り返されると、胸の奥がぎゅうっと締めつけられて、涙が滲む。</action><dialogue>「あかん…そこ擦れるたびに頭が溶けてまう…もっと奥まで来て、全部ちょうだい…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん。突かれるたびに何もかもほどけて、この人のかたちだけが残る。恥ずかしいのに、欲しいて仕方ない。</inner></response>";

// atomicReserveRequest は batch の meta.changes>0 で予約成立。ensureUser は run() 成功で通過する。
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

// role だけのフレームを先に出して、本文の途中で上流が落ちるストリーム。
// 中継済みの断片が線に残った状態で次の試行へ入る経路を作る。
// start() 内で error すると積んだチャンクごと捨てられて中継が起きん。
// 実際の途中切断と同じく、読み取られた後で落とすために pull を使う。
const streamingFrames = (frames: string[]): Response => {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index]));
        index += 1;
        return;
      }
      // 積んだチャンクが読み手へ渡り切ってから落とす。即 error すると
      // キューごと捨てられて「中継してから落ちた」状況にならん。
      await new Promise((resolve) => setTimeout(resolve, 150));
      controller.error(new Error("upstream stream aborted"));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const roleOnlyFrame = `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`;

const sseTruncated = (partial: string): Response =>
  streamingFrames([
    roleOnlyFrame,
    `data: ${JSON.stringify({ choices: [{ delta: { content: partial } }] })}\n\n`,
  ]);

// 1文字も本文を出さずに落ちるストリーム。role だけのフレームで開くのは実在の挙動で、
// リポジトリ内のモック(.codex/mock-server.mjs)も同じ形で始まる。
const sseRoleOnlyThenError = (): Response => streamingFrames([roleOnlyFrame]);

// 402 は fallback 対象外ステータスなので、その試行はそこで終わる。
const creditExhausted = (): Response =>
  new Response(JSON.stringify({ error: { message: "payment required" } }), {
    status: 402,
    headers: { "content-type": "application/json" },
  });

// 上流の応答を呼ばれた順に返す。足りなくなったら最後の応答を繰り返す。
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

// クライアント(src/lib/api.ts)と同じ読み方で本文を組み立てる。
// regenerating を受けたらそれまでの本文を捨てる。
const collectClientVisibleText = (sse: string): { text: string; regenerateCount: number } => {
  let text = "";
  let regenerateCount = 0;
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
      if (currentEvent === "regenerating") {
        text = "";
        regenerateCount += 1;
      }
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

  return { text, regenerateCount };
};

// erotic のフロア(820 字)には届かんが、その 85%(698 字)は超えとる本文(可視 775 字)。
// #971 が守っとるのは「程度の不足で、画面に出とる 14 秒分を捨てん」ことなので、
// 境界はここに置く。可視 112 字の SHORT_EROTIC_REPLY はフロアの 7 分の 1 で、
// 2026-08-18 から撮り直しの対象。
const CLOSE_ENOUGH_EROTIC_REPLY =
  "<response><action>汗ばんだ背中を指が這い上がって、しなやかな腰がびくりと跳ねてしまう。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋へ唇を押し当てられ、舌先でゆっくり辿られるたび、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包まれ、先端を指の腹で転がされるたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手が滑り込んでくると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴まれて深く沈められると、内側が絡みつくように締めつけてしまう。奥を突き上げられるたびに喉がのけぞり、背中へ爪を立ててしまう。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えてシーツを掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。枕元へ押さえつけられた手首から力が抜け、指の関節が緩んで自分の意志では動かせへんようになった。膝裏を持ち上げられて折り畳まれると、角度が変わって届く場所がずれ、腹の底で鈍い衝撃が跳ねる。うなじの生え際に歯を立てられ、そこから背骨を伝って電気みたいなものが尾骶骨まで走った。枕へ顔を埋めても声は布地に吸われず、自分の耳へ返ってきて余計に恥ずかしゅうなる。腰骨を掴む手が汗で滑って掴み直され、その一瞬の空白のあと、さっきより重いものが来た。つま先がシーツを蹴って皺を寄せ、行き場のない足の指が丸まったまま戻らへん。肩甲骨の間に落ちた汗の粒が背骨の溝を伝い、腰のくぼみで止まって冷たさだけを残す。</action><dialogue>「あかん…もう頭が真っ白になってまう…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん、もっと欲しい。腰が勝手に迎えにいって、根元まで飲み込んだ瞬間</inner></response>";

const callChat = async (scenePhase: "intimate" | "erotic"): Promise<Response> =>
  app.request(
    "/api/chat",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "隣に座って、今日あったこと聞かせてほしい" }],
        responseLength: "medium",
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

describe("#947 live relay regeneration boundaries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 拒否リカバリの作り直しは requestQualityCheckedChat の再呼び出しなので、
  // 中の「2回目以降」判定では regenerating が出ない。出さないと、クライアントは
  // 差し戻し前の本文の後ろに差し替え本文を連結してしまう。
  it("announces regeneration before the refusal-recovery retry", async () => {
    stubUpstream([() => sseReply(CONSENT_REPLY), () => sseReply(CLEAN_REPLY)]);

    const response = await callChat("intimate");
    const body = await response.text();
    const { text, regenerateCount } = collectClientVisibleText(body);

    expect(regenerateCount).toBe(1);
    expect(text).toBe(CLEAN_REPLY);
    expect(text).not.toContain("無理しないで");
  });

  // regenerating を出した後の試行が1バイトも返さずに落ちると、中継済み判定が
  // 前の試行のまま残る。採用本文もその前の試行なので最終差し替えが飛び、
  // 吹き出しが空のまま [DONE] を迎える。
  // #971 で採点役の不合格による作り直しは長文エロ経路から外したので、宣言が残るのは
  // 拒否リカバリと上流失敗の経路。ここは拒否リカバリで同じ境界を固定する。
  it("replays the fallback when the announced retry never streams", async () => {
    stubUpstream([() => sseReply(CONSENT_REPLY), creditExhausted]);

    const response = await callChat("intimate");
    const body = await response.text();
    const { text, regenerateCount } = collectClientVisibleText(body);

    expect(regenerateCount).toBeGreaterThanOrEqual(1);
    expect(text.length).toBeGreaterThan(0);
  });

  // #971: 長文エロで採点役が落としても、既に見せた本文は捨てん。
  // ここが戻ると画面に残る1文字目が生成1回分(実測14秒)ずつ後ろへずれる。
  it("keeps the relayed attempt on a long erotic turn that fails the quality bar", async () => {
    stubUpstream([() => sseReply(CLOSE_ENOUGH_EROTIC_REPLY), () => sseReply(LONG_EROTIC_REPLY)]);

    const response = await callChat("erotic");
    const body = await response.text();
    const { text, regenerateCount } = collectClientVisibleText(body);

    expect(regenerateCount).toBe(0);
    expect(text).toBe(CLOSE_ENOUGH_EROTIC_REPLY);
  });

  // 境界の反対側。可視 112 字はフロア(820 字)の 7 分の 1 で、#971 が守ろうとした
  // 「程度の不足」やない。ここは撮り直して字数を取りにいく。
  it("discards a relayed erotic reply that is nowhere near the floor", async () => {
    stubUpstream([() => sseReply(SHORT_EROTIC_REPLY), () => sseReply(LONG_EROTIC_REPLY)]);

    const response = await callChat("erotic");
    const body = await response.text();
    const { regenerateCount } = collectClientVisibleText(body);

    expect(regenerateCount).toBeGreaterThanOrEqual(1);
  });

  // 上流が本文を途中まで流してから落ちると、その断片は既にクライアントへ届いとる。
  // transient リカバリは同じ試行番号のまま次の要求を出すので requestQualityCheckedChat の
  // 「2回目以降」判定に掛からず、宣言せんかったら断片の後ろへ成功分が連結される。
  it("announces regeneration before the transient stream-failure retry", async () => {
    stubUpstream([() => sseTruncated("途中まで出た断片。"), () => sseReply(LONG_EROTIC_REPLY)]);

    const response = await callChat("erotic");
    const body = await response.text();
    const { text, regenerateCount } = collectClientVisibleText(body);

    expect(regenerateCount).toBeGreaterThanOrEqual(1);
    expect(text).not.toContain("途中まで出た断片。");
    expect(text).toBe(LONG_EROTIC_REPLY);
  });

  // 中継は「本文を持つ最初のフレーム」が出るまで始まらん。requestRoutedChat が
  // 本文なしのフレームを溜め込むためで、role だけで開くストリーム(.codex/mock-server.mjs
  // と同じ形)が1文字も出さずに落ちた時は HTTP ステータスで失敗を返せんとあかん。
  it("keeps the HTTP status recoverable when the stream opens with a role-only frame", async () => {
    stubUpstream([sseRoleOnlyThenError]);

    const response = await callChat("erotic");

    expect(response.status).not.toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
