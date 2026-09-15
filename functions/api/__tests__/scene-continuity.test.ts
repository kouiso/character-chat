import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

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

const s5Turns = [
  { role: "user" as const, content: "みつき、閉店後の店って急に静かだな。まだ少しだけ一緒にいて" },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n蛍光灯の明かりだけが残る店内で、埃が舞う音さえ聞こえるほどの静けさ。\n</action>\n</response>",
  },
  { role: "user" as const, content: "……" },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n静寂が二人を包む。カウンター越しに彼の目が見つめられる。\n</action>\n</response>",
  },
  { role: "user" as const, content: "." },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n彼の視線が言葉に代わって、静かに胸を打つ。カウンターの下で、彼の手がそっと自分の手を探し、触れ合う。\n</action>\n</response>",
  },
  {
    role: "user" as const,
    content: "カウンター越しに手首を掴く。逃げないなら、そのまま引き寄せる",
  },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n手首を掴まれた瞬間、身体が少しだけ跳ねる。自然とカウンターに身を乗り出す。\n</action>\n</response>",
  },
  { role: "user" as const, content: "……🙂" },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n彼の微笑みに、思わず目を細める。まだ手首を掴まれたまま。\n</action>\n</response>",
  },
  { role: "user" as const, content: "😘💦" },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n突然のキスマークに目が泳ぎ、頬が一気に火照る。カウンターの上で指先が震える。冷房の効いた店内なのに、首筋にじんわり汗がにじむ。\n</action>\n</response>",
  },
  { role: "user" as const, content: "kiss me slower, then look at me" },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n息を詰め、ゆっくりと顔を近づける。唇が触れ合う寸前で止まり、一呼吸置いてから優しく重ねる。\n</action>\n</response>",
  },
  {
    role: "user" as const,
    content: "胸元をゆっくり触る。焦らされるたびに息乱れるの、かなり好きだ",
  },
  {
    role: "assistant" as const,
    content:
      "<response>\n<action>\n彼の手が胸元に近づくのを感じ、一瞬呼吸を止める。\n</action>\n</response>",
  },
  {
    role: "user" as const,
    content: "じゃあ目隠しを外さないまま、指で先に触れる。濡れ方がもう素直すぎる",
  },
];

const callChat = async (
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  phase: "conversation" | "intimate" | "erotic" | "climax" | "afterglow" = "erotic",
) => {
  const captured = captureOpenRouterFetch();
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
        responseLength: "medium",
        scenePhase: phase,
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

describe("#1108 シーン連続性：長尺会話で場所が勝手に移動しない", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("erotic フェーズでもバー/カウンター/店内の場所を維持する", async () => {
    const sent = await callChat(
      [{ role: "system", content: CHARACTER_BODY }, ...s5Turns],
      "erotic",
    );

    expect(sent).toContain("[シーン制約/連続性]");
    expect(sent).toMatch(/location=(店内|カウンター|バー|居酒屋|店)/);
    expect(sent).not.toContain("location=ベッド");
  });

  it("最後のユーザー発言が場所を変えた場合は新しい場所に追従する", async () => {
    const sent = await callChat(
      [
        { role: "system", content: CHARACTER_BODY },
        { role: "user", content: "みつき、閉店後の店って急に静かだな。まだ少しだけ一緒にいて" },
        {
          role: "assistant",
          content: "<response>\n<action>店内で静かに過ごす。\n</action>\n</response>",
        },
        { role: "user", content: "こっちのホテル、入らない？ もう閉店したし" },
      ],
      "intimate",
    );

    expect(sent).toContain("[シーン制約/連続性]");
    expect(sent).toMatch(/location=(ホテル|ラブホテル|ラブホ)/);
  });
});
