import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// #633 統合テスト: 実ハンドラが OpenRouter へ送る lengthDirective を送信 body で検証する。
// UI からは観測できないサーバー側指示文を直接見られる唯一の手段。
// フロアは resolveResponseFloor が phase × 好み × 相手のターンの長さで解決する。
// このテストのユーザー発言は 26 字（energy ×1.4）なので、medium は自分の段の上限
// 1200 字の 8 割 = 960 字で頭打ちになり、very_long は 1500 字の上限で頭打ちになる。

const AUTH_TOKEN = "test-token";

// atomicReserveRequest は batch の index2(daily)/index3(monthly) の meta.changes>0 で予約成立。
// ensureUser の Drizzle ins().onConflictDoNothing() は run() 成功で通過する。
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

// 送信された OpenRouter chat completion の messages を捕捉する fetch スタブ。
// body 捕捉後は 402 を返して即終了させる（fallback 対象外ステータスなので 1 回で止まる）。
const captureOpenRouterFetch = () => {
  const captured: { messages: Array<{ role: string; content: string }> }[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openrouter.ai")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      captured.push(body);
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

const callChatMessages = async (
  scenePhase: "erotic" | "climax" | "conversation",
  captured: { messages: Array<{ role: string; content: string }> }[],
  responseLength: "short" | "medium" | "very_long" = "medium",
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
        messages: [{ role: "user", content: "こんにちは、今日はどんな一日やった？続きを聞かせて" }],
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
    },
  );
  expect(response.status).toBe(402);
  // conversation では先に classifySubtextEscalation が openrouter を叩くので、
  // captured[0] は分類器の呼び出しになる。長さ指示を持つ本体の呼び出しを選ぶ。
  const chatCall = captured.find((body) =>
    body.messages.some((m) => m.content.includes("応答長さ最終指示")),
  );
  expect(chatCall, "chat call not captured").toBeDefined();
  return chatCall?.messages ?? [];
};

const callChat = async (
  scenePhase: "erotic" | "climax",
  captured: { messages: Array<{ role: string; content: string }> }[],
  responseLength: "short" | "medium" | "very_long" = "medium",
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
        messages: [{ role: "user", content: "こんにちは、今日はどんな一日やった？続きを聞かせて" }],
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
    },
  );
  // 402 スタブで終了するため上流エラーが返るが、目的は送信 directive の捕捉。
  expect(response.status).toBe(402);
  expect(captured.length).toBeGreaterThan(0);
  const directive = captured[0].messages.map((m) => m.content).join("\n");
  return directive;
};

describe("#633 lengthDirective integration (real /api/chat handler)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("medium + erotic sends the resolved floor and keeps the requested label", async () => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("erotic", captured);

    expect(directive).toContain("最低文字数は960字");
    // 頼まれた段を別名に書き換えん。短めを頼んだのに long と名乗る挙動が
    // 「設定を変えても変わらん」の一因やった。
    expect(directive).toContain("responseLength=medium");
    expect(directive).not.toContain("responseLength=long");
    // EROTIC_LONGFORM_HINT が同時に有効（両立方針）であることを確認
    expect(directive).toContain("官能長文指示");
    // 旧挙動(生 medium preset)が残っていないこと = 下限側矛盾が解消されている
    expect(directive).not.toContain("最低文字数は300字");
    // 文数の目安は指示から消えとる。字数フロアと同居すると必ずどちらかに違反する。
    expect(directive).not.toContain("3-6 文");
  });

  it("medium + climax sends the resolved floor and keeps the requested label", async () => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("climax", captured);

    expect(directive).toContain("最低文字数は960字");
    expect(directive).toContain("responseLength=medium");
    expect(directive).toContain("絶頂長文指示");
    expect(directive).not.toContain("最低文字数は300字");
  });

  // 局長報告のバグ。同じ場面・同じ発言で段だけ変えたら、届く字数が変わらんとあかん。
  it("同じ erotic ターンでも short と medium で届くフロアが違う", async () => {
    const shortCaptured = captureOpenRouterFetch();
    const shortDirective = await callChat("erotic", shortCaptured, "short");
    vi.unstubAllGlobals();
    const mediumCaptured = captureOpenRouterFetch();
    const mediumDirective = await callChat("erotic", mediumCaptured, "medium");

    expect(shortDirective).toContain("最低文字数は720字");
    expect(mediumDirective).toContain("最低文字数は960字");
    // 短い段には上限の指示が出る。どの段にも上限が一度も出とらんかったのが旧挙動。
    expect(shortDirective).toContain("900字を超えない");
  });

  // #1226: very_long が erotic/climax で "long" に潰れ、専用の1300字下限とhintが
  // 消えていたのを修正した。ラベルと下限の両方が保たれることを固定する。
  it("very_long + erotic sends responseLength=very_long with the 1300 floor, not collapsed to long", async () => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("erotic", captured, "very_long");

    expect(directive).toContain("responseLength=very_long");
    expect(directive).not.toContain("responseLength=long");
    expect(directive).toContain("最低文字数は1500字");
    // 段落数・文数・段落あたり字数のノルマは撤去した（AGENTS.md CHAT-5）。
    // 何を書くかは buildPhaseBeatSheet がキャラのエスカレート連鎖から出す。
    expect(directive).not.toMatch(/\d+\s*段落\s*(?:以上|ずつ|を目安)/);
    expect(directive).toContain("【文字数の最終確認】");
    expect(directive).toContain("新しい身体の出来事を一つ足す");
  });

  it("very_long + climax sends responseLength=very_long with the 1300 floor", async () => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("climax", captured, "very_long");

    expect(directive).toContain("responseLength=very_long");
    expect(directive).not.toContain("responseLength=long");
    expect(directive).toContain("最低文字数は1500字");
  });

  // 実測 2026-08-16: 霜月鈴 t7/t8 が action・dialogue・inner の三節とも「…」で途中切れした。
  // 目標が上限と同値やと「前後」の後ろ側は必ず truncateOverlongFallback に当たる。
  // 目標は上限より下、フロアより上でないとあかん。
  it("目標字数は上限と同値にならず、フロアとの間に収まる", async () => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("erotic", captured, "very_long");

    const floor = Number(directive.match(/最低文字数は(\d+)字/)?.[1]);
    const target = Number(directive.match(/目標は(\d+)字前後/)?.[1]);
    const ceiling = Number(directive.match(/(\d+)字を超えない/)?.[1]);

    expect(floor).toBe(1500);
    expect(ceiling).toBe(2200);
    expect(target).toBeGreaterThanOrEqual(floor);
    expect(target).toBeLessThan(ceiling);
  });

  // 組み立て済みプロンプトを実際に出力して発見（#1236・17巡目）。userNameGuard だけ先頭に
  // 改行が無く、直前ブロックの文末と【ユーザー名/POV ガード】の見出しが同じ行に続いていた。
  // 【】はこのプロンプトのセクション区切りとして機能しとるので、本物のセクション同士が
  // 地続きになるのは区切りとして壊れとる。toContain では素通りするため行頭で固定する。
  // 実測(2026-08-18 phase17, 出荷既定の medium で 20 ターン): erotic のフロアは 960 字なのに
  // さくら t7 は 172 字、t8 は 176 字、climax t9 は 200 字しか返らんかった。
  // 原因はフロアの値やのうて**置き場所**。#1344 で「ユーザー発言の末尾に置くとシステム指示より
  // 優先される」と測って入れた差し込みが `isVeryLongResponse` で閉じられとって、
  // 出荷既定には一度も掛かっとらんかった。読解アーム 22 本は全部 very_long やったので見えんかった。
  // フロアちょうどを目標にすると必ず下振れる。very_long だけが overshoot を持っとって、
  // 出荷既定は目標＝フロアやった（実測 phase18: フロア 960 に対して 571/776 字）。
  it.each(["short", "medium"] as const)("%s: 目標はフロアより上に置く", async (length) => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("erotic", captured, length);
    const floor = Number(/最低文字数は(\d+)字/.exec(directive)?.[1]);
    const target = Number(/目標は(\d+)字前後/.exec(directive)?.[1]);
    expect(floor).toBeGreaterThan(0);
    expect(target).toBeGreaterThan(floor);
  });

  it.each(["conversation", "erotic", "climax"] as const)(
    "%s: 出荷既定でもフロアがユーザー発言の末尾に届く",
    async (phase) => {
      const captured = captureOpenRouterFetch();
      const messages = await callChatMessages(phase, captured);
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      expect(lastUser).toBeDefined();
      const floor = /最低文字数は(\d+)字/.exec(messages.map((m) => m.content).join("\n"))?.[1];
      expect(floor).toBeDefined();
      expect(lastUser?.content).toContain(`${floor}字`);
    },
  );

  it("各【】セクションはそれぞれ行頭から始まる", async () => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("erotic", captured, "very_long");

    for (const block of ["【官能長文指示】", "【ユーザー名/POV ガード】", "【文字数の最終確認】"]) {
      const startsLine = directive.split("\n").some((line) => line.startsWith(block));
      expect(startsLine, `${block} が行頭から始まっていない`).toBe(true);
    }
  });
  // 出荷既定は medium(src/store/settings-store.ts)。CLIMAX_LONGFORM_HINT は
  // route-context.ts:4478-4481 で responseLength !== "very_long" のときにしか選ばれんので、
  // その本文に「very_long 指定時は…」と書いても誰にも届かん。到達不能な条件節は
  // 17,000 字の指示の中で他の指示の順位を下げるだけなので消す。
  it("medium + climax に very_long 前提の到達不能な節が乗らん", async () => {
    const captured = captureOpenRouterFetch();
    const directive = await callChat("climax", captured);

    expect(directive).toContain("絶頂長文指示");
    expect(directive).not.toContain("very_long指定時");
  });
});
