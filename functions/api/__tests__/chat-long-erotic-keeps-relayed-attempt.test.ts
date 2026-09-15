import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";
import { CLAUDE_JUDGE_MODEL } from "../lib/route-context";

// #971: エロ段階の1回の生成に14秒かかるので、画面に出した本文を捨てて撮り直すと
// ユーザーが最後に読む1文字目が27〜33秒まで後ろへずれる（#946 の10秒要件を割る）。
// 長文エロ/クライマックスでは、採点役が不合格を出しても中継済みの本文を捨てん。
// ここが戻ると体感が壊れるので、上流を何回呼んだかまで含めて固定する。

const AUTH_TOKEN = "test-token";

// erotic の長文フロア(600字)に届かんので採点役の前に決定的チェックで不合格になる。
// 撮り直しが復活したら、この本文が捨てられて2回目の生成が走る。
const SHORT_EROTIC_REPLY =
  "<response><action>熱を帯びた肌が触れ合って、指先が背中をなぞるたびに息が詰まる。汗ばんだ首筋に唇を寄せると、甘い声が漏れて、体の奥がとろけるように疼いた。腰を引き寄せられて、深く重なった瞬間、視界が白く弾ける。</action><dialogue>「もっと…あかん、止まらへん…」</dialogue><inner>頭が真っ白になって、何も考えられへん。もっと欲しい。</inner></response>";

// 長さは足りとるが英語が混ざっとる本文。構造的な壊れなので撮り直しの対象のまま。
const ENGLISH_LEAK_REPLY =
  "<response><action>汗ばんだ背中へ指を這わせると、しなやかな腰がびくりと跳ねた。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てて舌先でゆっくり辿れば、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包み、先端を指の腹で転がすたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手を滑らせると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴んで深く沈み込ませれば、内側が絡みつくように締めつけてきた。奥を突き上げるたびに白い喉がのけぞり、背中へ爪が食い込む。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えてシーツを掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。She could not stop trembling as the heat spread through her whole body and the room went quiet.</action><dialogue>「あかん…もう頭が真っ白になってまう…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん。</inner></response>";

// 長さは足りとるが <action> が無い本文。scene_short カテゴリやけど構造的な壊れ。
const ACTION_MISSING_REPLY =
  "<response><action> </action><dialogue>「あかん…そこ擦れるたびに頭が溶けてまう…もっと奥まで来て、全部ちょうだい…声、我慢でけへん…」</dialogue><inner>汗ばんだ背中へ指を這わせられるたび、しなやかな腰がびくりと跳ねる。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てられて舌先でゆっくり辿られたら、甘い声が喉の奥から零れ落ちた。胸のふくらみを掌で包まれ、先端を指の腹で転がされるたび、太腿の内側がひくついて熱いしずくが伝う。脚のあいだへ手を滑らされると、そこはもうとろけきっていて、粘つく水音が耳を打った。腰を掴まれて深く沈み込まされれば、内側が絡みつくように締めつけてまう。奥を突き上げられるたびに喉がのけぞって、背中へ爪が食い込む。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えてシーツを掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。腰が勝手に迎えにいって、根元まで飲み込んだ瞬間、爪先までぴんと張り詰めた。指を絡めて握り返されると、胸の奥がぎゅうっと締めつけられて、涙が滲む。シーツを掴む指の力が抜けて、体の芯だけが熱を持ったまま溶けていく。</inner></response>";

// 中身が空の本文。#976 の歯止めと同じく、この経路でも配信させん。
const EMPTY_REPLY = "<response><action></action><dialogue></dialogue><inner></inner></response>";

// 600字未満で、かつ <action> が空。長さ不足の判定が先に返るせいで XML の必須要素の
// 欠落が隠れる形。長さフロアを外した再チェックで捕まえる。
const SHORT_AND_ACTION_MISSING_REPLY =
  "<response><action> </action><dialogue>「あかん…そこ擦れるたびに頭が溶けてまう…もっと奥まで来て…」</dialogue><inner>汗ばんだ背中へ指を這わせられるたび、しなやかな腰がびくりと跳ねる。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋に唇を押し当てられて舌先でゆっくり辿られたら、甘い声が喉の奥から零れ落ちた。胸のふくらみを掌で包まれ、先端を指の腹で転がされるたび、太腿の内側がひくついて熱いしずくが伝う。</inner></response>";

const SECOND_ATTEMPT_REPLY =
  "<response><action>撮り直しで出てきた本文。これが画面に出たら中継済みの本文を捨てとる。</action><dialogue>「二回目や」</dialogue><inner>捨てられた。</inner></response>";

// ENGLISH_LEAK_REPLY から英語文だけを抜いて600字超まで書き足した、決定的チェックを全部通る長文。
// judge(採点役)まで到達させたいテスト専用に使う。
// <inner> は 120 字ちょうどで畳まれる（2026-08-18 に very_long 以外へも掛けた）。
// このテストが押さえとるのは judge の verdict の扱いなので、fixture 側を上限内にする。
// 可視文字 846 字。medium/erotic のフロア(820 字)を可視文字で超えさせとる。
// 以前は 735 字しか無く、タグ込みの 918 字でフロアを満たしとった。長さ判定が
// 可視文字へ揃った時点で、この fixture は長さで先に落ちて採点役へ届かんくなる。
const CLEAN_LONG_EROTIC_REPLY =
  "<response><action>汗ばんだ背中を指が這い上がって、しなやかな腰がびくりと跳ねてしまう。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋へ唇を押し当てられ、舌先でゆっくり辿られるたび、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包まれ、先端を指の腹で転がされるたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手が滑り込んでくると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴まれて深く沈められると、内側が絡みつくように締めつけてしまう。奥を突き上げられるたびに喉がのけぞり、背中へ爪を立ててしまう。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えてシーツを掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。枕元へ押さえつけられた手首から力が抜け、指の関節が緩んで自分の意志では動かせへんようになった。膝裏を持ち上げられて折り畳まれると、角度が変わって届く場所がずれ、腹の底で鈍い衝撃が跳ねる。うなじの生え際に歯を立てられ、そこから背骨を伝って電気みたいなものが尾骶骨まで走った。枕へ顔を埋めても声は布地に吸われず、自分の耳へ返ってきて余計に恥ずかしゅうなる。腰骨を掴む手が汗で滑って掴み直され、その一瞬の空白のあと、さっきより重いものが来た。つま先がシーツを蹴って皺を寄せ、行き場のない足の指が丸まったまま戻らへん。肩甲骨の間に落ちた汗の粒が背骨の溝を伝い、腰のくぼみで止まって冷たさだけを残す。喉の渇きに舌が上顎へ貼りつき、掠れた音しか出せへんまま口だけが開いた。天井の木目が滲んで二重に見え、まばたきのたび睫毛の湿りが視界を歪ませる。</action><dialogue>「あかん…もう頭が真っ白になってまう…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん、もっと欲しい。腰が勝手に迎えにいって、根元まで飲み込んだ瞬間、爪先までぴんと張り詰めた。指を絡めて握り返されると、胸の奥がぎゅうっと締めつけられて、涙が滲む。</inner></response>";

// erotic のフロア(820 字)にも climax のフロア(900 字)にも届かんが、どちらの 85%
// （698 字 / 765 字）も超えとる本文（可視 775 字）。#971 の「あと一歩は撮り直さん」
// 側の対照に使う。CLEAN_LONG_EROTIC_REPLY を文単位で切り詰めて作っとる。
const CLOSE_ENOUGH_EROTIC_REPLY =
  "<response><action>汗ばんだ背中を指が這い上がって、しなやかな腰がびくりと跳ねてしまう。薄闇のなかで濡れた肌が鈍い光を返し、荒い息づかいだけが部屋を満たしていく。首筋へ唇を押し当てられ、舌先でゆっくり辿られるたび、甘い声が喉の奥から零れ落ちる。胸のふくらみを掌で包まれ、先端を指の腹で転がされるたび、太腿の内側がひくついて熱いしずくが伝った。脚のあいだへ手が滑り込んでくると、そこはもうとろけきっていて、粘つく水音が耳を打つ。腰を掴まれて深く沈められると、内側が絡みつくように締めつけてしまう。奥を突き上げられるたびに喉がのけぞり、背中へ爪を立ててしまう。汗と体液の匂いが混ざり合って、視界の端が白く滲んでいった。膝が震えてシーツを掻き乱し、乱れた髪が頬に貼りつく。呼吸の合間に名前を呼ばれるたび、腰の奥がきゅうっと疼いて止まらへんかった。耳元へ吹きかかる吐息が湿って、鼓膜まで甘く痺れさせる。腕を回して引き寄せられると、胸の先が擦れて小さな悲鳴が漏れた。窓の外の雨音が遠のいて、聞こえるのは肌のぶつかる音と、途切れ途切れの呼吸だけになる。枕元へ押さえつけられた手首から力が抜け、指の関節が緩んで自分の意志では動かせへんようになった。膝裏を持ち上げられて折り畳まれると、角度が変わって届く場所がずれ、腹の底で鈍い衝撃が跳ねる。うなじの生え際に歯を立てられ、そこから背骨を伝って電気みたいなものが尾骶骨まで走った。枕へ顔を埋めても声は布地に吸われず、自分の耳へ返ってきて余計に恥ずかしゅうなる。腰骨を掴む手が汗で滑って掴み直され、その一瞬の空白のあと、さっきより重いものが来た。つま先がシーツを蹴って皺を寄せ、行き場のない足の指が丸まったまま戻らへん。肩甲骨の間に落ちた汗の粒が背骨の溝を伝い、腰のくぼみで止まって冷たさだけを残す。</action><dialogue>「あかん…もう頭が真っ白になってまう…」</dialogue><inner>体の芯が熱うて、指先まで痺れとる。もう自分でも止められへん、もっと欲しい。腰が勝手に迎えにいって、根元まで飲み込んだ瞬間</inner></response>";

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

// 生成の呼び出し回数を数える。採点役も同じ openrouter を叩くので、
// 本文生成(stream:true)だけを数えて撮り直しの有無を判定する。
// judgeVerdict を渡すと、judge(CLAUDE_JUDGE_MODEL)宛のリクエストだけその verdict 文字列
// (例: "FAIL:SENSORY:...")をそのまま返す。渡さん時は従来どおりパース不能な固定文言を返す
// (judge は fail-open で ran:null になり、決定的チェックの不合格だけを試験する経路になる)。
const stubUpstream = (
  replies: (() => Response)[],
  judgeVerdict?: string,
): { generationCalls: () => number } => {
  let generation = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      const bodyText = String(init?.body ?? "");
      const isGeneration = bodyText.includes('"stream":true');
      if (!isGeneration) {
        if (judgeVerdict && bodyText.includes(`"model":"${CLAUDE_JUDGE_MODEL}"`)) {
          return new Response(
            JSON.stringify({ choices: [{ message: { content: judgeVerdict } }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        // 採点役は「不合格」を返す。撮り直しの引き金を残したまま体感を守れるかを見る。
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"pass":false,"reason":"性的描写が具体的でない"}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const make = replies[Math.min(generation, replies.length - 1)];
      generation += 1;
      return make();
    }),
  );
  return { generationCalls: () => generation };
};

const readSse = (sse: string): { text: string; regenerateCount: number } => {
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

const readQualityMeta = (sse: string): Record<string, unknown> | null => {
  const lines = sse.split("\n");
  const idx = lines.findIndex((line) => line.startsWith("event: quality-meta"));
  if (idx === -1) return null;
  const dataLine = lines.slice(idx).find((line) => line.startsWith("data: "));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6).trim()) as Record<string, unknown>;
};

const callChat = async (
  scenePhase: "erotic" | "climax" | "conversation",
  responseLength: "short" | "medium" | "long" | "very_long" = "medium",
): Promise<Response> =>
  app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "そのまま続けて、もっと近くに来てほしい" }],
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

describe("#971 long erotic turns keep the text already shown", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // fixture を SHORT_EROTIC_REPLY(可視 115 字＝フロアの 7 分の 1)から
  // CLOSE_ENOUGH_EROTIC_REPLY(可視 775 字)へ替えた。#971 が守っとるのは
  // 「程度の不足で、画面に出とる 14 秒分を捨てん」ことであって、7 分の 1 しか書けてへん
  // 本文まで配ることやない。極端な不足の側は下の
  // "regenerates a medium erotic reply of the same shortfall" が受ける。
  it.each(["erotic", "climax"] as const)(
    "does not discard the relayed attempt on a %s turn that fails the quality bar",
    async (phase) => {
      const upstream = stubUpstream([
        () => sseReply(CLOSE_ENOUGH_EROTIC_REPLY),
        () => sseReply(SECOND_ATTEMPT_REPLY),
      ]);

      const body = await (await callChat(phase)).text();
      const { text, regenerateCount } = readSse(body);

      expect(regenerateCount).toBe(0);
      expect(text).toBe(CLOSE_ENOUGH_EROTIC_REPLY);
      expect(text).not.toContain("撮り直しで出てきた本文");
      // 2回目の生成を投げた時点で14秒が積まれる。1回で終わっとることまで固定する。
      expect(upstream.generationCalls()).toBe(1);
    },
  );

  it("still reports the failed verdict so quality stays observable", async () => {
    stubUpstream([() => sseReply(CLOSE_ENOUGH_EROTIC_REPLY)]);

    const body = await (await callChat("erotic")).text();

    expect(readQualityMeta(body)).toMatchObject({ warningLevel: true, retryCount: 0 });
  });

  // 濃さ・長さの不足だけが対象。本文自体が壊れとる不合格は今までどおり撮り直す。
  it("still discards a structurally broken reply on a long erotic turn", async () => {
    const upstream = stubUpstream([
      () => sseReply(ENGLISH_LEAK_REPLY),
      () => sseReply(SECOND_ATTEMPT_REPLY),
    ]);

    const body = await (await callChat("erotic")).text();
    const { regenerateCount } = readSse(body);

    expect(upstream.generationCalls()).toBeGreaterThan(1);
    expect(regenerateCount).toBeGreaterThanOrEqual(1);
  });

  // scene_short カテゴリでも action / inner 欠落は構造的な壊れなので撮り直す。
  it("still discards a reply that is missing a required XML section", async () => {
    const upstream = stubUpstream([
      () => sseReply(ACTION_MISSING_REPLY),
      () => sseReply(SECOND_ATTEMPT_REPLY),
    ]);

    const body = await (await callChat("erotic")).text();
    const { regenerateCount } = readSse(body);

    expect(upstream.generationCalls()).toBeGreaterThan(1);
    expect(regenerateCount).toBeGreaterThanOrEqual(1);
  });

  // #975 / #976: 中身が空の本文はこの経路でも配信させん。
  it("never keeps an empty reply", async () => {
    const upstream = stubUpstream([() => sseReply(EMPTY_REPLY), () => sseReply(EMPTY_REPLY)]);

    const body = await (await callChat("erotic")).text();
    const { text } = readSse(body);

    expect(upstream.generationCalls()).toBeGreaterThan(1);
    expect(text.replace(/<[^>]+>/g, "").trim()).toBe("");
  });

  // 長さ不足の判定が先に返って、その後ろの構造チェックが隠れる場合。
  it("still discards an underlength reply that also breaks the XML contract", async () => {
    const upstream = stubUpstream([
      () => sseReply(SHORT_AND_ACTION_MISSING_REPLY),
      () => sseReply(SECOND_ATTEMPT_REPLY),
    ]);

    const body = await (await callChat("erotic")).text();
    const { regenerateCount } = readSse(body);

    expect(upstream.generationCalls()).toBeGreaterThan(1);
    expect(regenerateCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps retrying on the paths that are not long erotic", async () => {
    const upstream = stubUpstream([
      () => sseReply(SHORT_EROTIC_REPLY),
      () => sseReply(SECOND_ATTEMPT_REPLY),
    ]);

    const body = await (await callChat("conversation")).text();
    const { regenerateCount } = readSse(body);

    expect(upstream.generationCalls()).toBeGreaterThan(1);
    expect(regenerateCount).toBeGreaterThanOrEqual(1);
  });
});

// #1226/#1236: very_long は下限1300字に対して最大1220字も不足しうる。short/medium/long は
// #971 のとおり「中継済みをそのまま出す」緩さを保つが、very_long だけはユーザーが明示した
// 「たっぷり」を大きく割り込むため、長さ不足でも撮り直しを発火させる。
describe("#1226/#1236 very_long erotic turns retry a reply far below the 1300-char floor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("regenerates a very_long erotic reply that is far short of the 1300-char floor", async () => {
    const upstream = stubUpstream([
      () => sseReply(SHORT_EROTIC_REPLY),
      () => sseReply(SECOND_ATTEMPT_REPLY),
    ]);

    const body = await (await callChat("erotic", "very_long")).text();
    const { regenerateCount } = readSse(body);

    expect(upstream.generationCalls()).toBeGreaterThan(1);
    expect(regenerateCount).toBeGreaterThanOrEqual(1);
  });

  // medium も同じ極端な不足なら撮り直す。#1226/#1236 は「short/medium/long は中継済みを
  // そのまま出す」と決めとったが、それはフロアが実質死んどった頃の判断。実測でひっくり返った:
  //   phase26 erotic 703/749 climax 724 ／ phase27 erotic 504/719/409/448 climax 772/458
  //   — フロア 820〜960 に対して 9/9 割れ。指示文で潰す試み(phase27)は t7 を悪化させた。
  it("regenerates a medium erotic reply of the same shortfall", async () => {
    const upstream = stubUpstream([
      () => sseReply(SHORT_EROTIC_REPLY),
      () => sseReply(SECOND_ATTEMPT_REPLY),
    ]);

    const body = await (await callChat("erotic", "medium")).text();
    const { regenerateCount } = readSse(body);

    expect(upstream.generationCalls()).toBeGreaterThan(1);
    expect(regenerateCount).toBeGreaterThanOrEqual(1);
  });

  // 対照: 「あと一歩」は撮り直さん。#971 のレイテンシ要件はここで守る。
  // erotic のフロア 820 字の 85%（＝698 字）を超えとる本文（可視 775 字）は中継済みのまま配る。
  it("still keeps a medium erotic reply that is within 85% of the floor", async () => {
    const upstream = stubUpstream([
      () => sseReply(CLOSE_ENOUGH_EROTIC_REPLY),
      () => sseReply(SECOND_ATTEMPT_REPLY),
    ]);

    const body = await (await callChat("erotic", "medium")).text();
    const { text, regenerateCount } = readSse(body);

    expect(regenerateCount).toBe(0);
    expect(text).toBe(CLOSE_ENOUGH_EROTIC_REPLY);
    expect(upstream.generationCalls()).toBe(1);
  });
});

// issue #1495 §8「LLM 採点をゲートにせん」で、配信経路から judge を外した
// （checkServerSideQuality が確定論チェックだけで判定する）。
// #1231/#1236 の「SENSORY 不合格なら撮り直す」は、その採点役が居った前提の挙動なので
// もう成立せん。ここでは逆向きに固定する: judge がどう言おうと撮り直しは起きん。
//
// 抜けとった具体描写は決定論側（checkSensualSpecificity）が今までどおり見とる。
// judge を外したのは「LLM の意見で本文を捨てる」ことと、1 ターンに LLM 往復を 1 本足して
// 70 秒の壁と 3 回の試行上限を続き書きと取り合うこと、この 2 つが目的やった。
describe("#1495 judge の判定は配信経路の撮り直し理由にせん", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("SENSORY 不合格の判定が返っても撮り直さん（そもそも judge を呼ばん）", async () => {
    const upstream = stubUpstream(
      [() => sseReply(CLEAN_LONG_EROTIC_REPLY), () => sseReply(SECOND_ATTEMPT_REPLY)],
      "FAIL:SENSORY:「気持ちいい」の反復だけで感覚の具体描写が無い",
    );

    const body = await (await callChat("erotic")).text();
    const { text, regenerateCount } = readSse(body);

    expect(regenerateCount).toBe(0);
    expect(text).toBe(CLEAN_LONG_EROTIC_REPLY);
    expect(upstream.generationCalls()).toBe(1);
  });

  it("DIFFERENT 不合格でも同じく撮り直さん", async () => {
    const upstream = stubUpstream(
      [() => sseReply(CLEAN_LONG_EROTIC_REPLY), () => sseReply(SECOND_ATTEMPT_REPLY)],
      "FAIL:DIFFERENT:前回と同じ表現を繰り返している",
    );

    const body = await (await callChat("erotic")).text();
    const { text, regenerateCount } = readSse(body);

    expect(regenerateCount).toBe(0);
    expect(text).toBe(CLEAN_LONG_EROTIC_REPLY);
    expect(upstream.generationCalls()).toBe(1);
  });
});

// issue #1495: 品質の撮り直しが何回走ったかは、これまでどこからも読めんかった。
// SSE の quality-meta に `retryCount` は在ったが中身は refusalRetryCount の複製で、
// 2026-08-20 の phase66 通読はその列を根拠に「climax の床が発火しとらん」と誤読しとる。
// 床や品質チェックが実際に効いたかを本文だけ見て判定するための唯一の手掛かりなので、
// 生成を何回走らせたかをそのまま出す。
describe("#1495 品質の撮り直し回数を quality-meta へ出す", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("一発で通ったターンは generationCount が 1", async () => {
    stubUpstream([() => sseReply(CLEAN_LONG_EROTIC_REPLY)]);

    const meta = readQualityMeta(await (await callChat("erotic")).text());

    expect(meta?.generationCount).toBe(1);
  });

  it("床で撮り直したターンは generationCount が増える", async () => {
    const upstream = stubUpstream([
      () => sseReply(SHORT_EROTIC_REPLY),
      () => sseReply(CLEAN_LONG_EROTIC_REPLY),
    ]);

    const meta = readQualityMeta(await (await callChat("erotic")).text());

    // 上流を呼んだ回数と一致すること。ここがズレると数字が嘘になる。
    expect(meta?.generationCount).toBe(upstream.generationCalls());
    expect(meta?.generationCount).toBeGreaterThan(1);
  });
});
