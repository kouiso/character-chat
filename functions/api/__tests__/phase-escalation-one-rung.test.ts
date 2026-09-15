import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";
import { resolveSubtextEscalationRequest } from "../lib/subtext-escalation-classifier";

// A5 / C3 (doc/backlog-2026-08-17.md)。局長「まだ胸の段やのに手マンに入る」。
//
// 機構: [[route]].ts の問い直しは inForeplay を
//   heuristicPhase === "intimate" || lastPhase === "intimate"
// で立てて、立ったら judgeTarget=erotic_escalation / target="erotic" にしとった。
// そのため
//   (a) キーワードが conversation と読んだターンでも、前ターンの配信フェーズが intimate なら
//       LLM の true 一発で erotic まで 2 段飛んだ。erotic の場面指示は
//       「Sexual intercourse is ALREADY in progress」なので、胸の段のまま挿入が始まる。
//   (b) 前戯 1 ターン目でも erotic へ上がれた。キーワード経路の昇格
//       （shouldProactivelyEscalateToErotic）は前戯 2 ターンを要求しとるのに、
//       LLM 経路だけ門が無かった。
// 上げてよいのは「キーワードが読んどる段の一つ上」までで、erotic は前戯が続いた時だけ。

describe("resolveSubtextEscalationRequest", () => {
  it("conversation のターンからは intimate までしか狙わん", () => {
    expect(
      resolveSubtextEscalationRequest({
        keywordPhase: "conversation",
        hasSustainedForeplay: false,
      }),
    ).toEqual({ judgeTarget: "user_invitation", target: "intimate" });
  });

  // 前ターンが intimate でも、キーワードが conversation なら erotic は飛び越えになる。
  // 床（applyPhaseFloor）が intimate まで戻すので、intimate を狙うだけで足りる。
  it("前戯が続いとっても conversation のターンから erotic へは飛ばさん", () => {
    expect(
      resolveSubtextEscalationRequest({ keywordPhase: "conversation", hasSustainedForeplay: true }),
    ).toEqual({ judgeTarget: "user_invitation", target: "intimate" });
  });

  it("前戯 1 ターン目の intimate では erotic を問い直さん", () => {
    expect(
      resolveSubtextEscalationRequest({ keywordPhase: "intimate", hasSustainedForeplay: false }),
    ).toBeNull();
  });

  it("前戯が続いた intimate なら erotic を問い直す", () => {
    expect(
      resolveSubtextEscalationRequest({ keywordPhase: "intimate", hasSustainedForeplay: true }),
    ).toEqual({ judgeTarget: "erotic_escalation", target: "erotic" });
  });

  // 実測 2026-08-18 phase17 / phase19 / phase21 / phase23（.work/e2e-results/vlong-dogfood/）:
  // 含みだけで書く霜月鈴の通しは keywordPhase が 10 ターン全部 conversation で、
  // erotic の門が一度も開かんかった。分類器が上げた intimate は次ターンの keywordPhase へ
  // 戻らんので、キーワードだけを基準にすると場面の実際の位置が見えん。
  // judge が渡す「The scene has already reached foreplay」の前提は、配信フェーズで
  // 前戯に達しとると分かっとる時には真になる。
  it("配信フェーズが intimate で前戯が続いとるなら、キーワードが conversation でも erotic を問う", () => {
    expect(
      resolveSubtextEscalationRequest({
        keywordPhase: "conversation",
        hasSustainedForeplay: true,
        servedPhase: "intimate",
      }),
    ).toEqual({ judgeTarget: "erotic_escalation", target: "erotic" });
  });

  it("配信フェーズが intimate でも前戯 1 ターン目なら問い直さん", () => {
    expect(
      resolveSubtextEscalationRequest({
        keywordPhase: "conversation",
        hasSustainedForeplay: false,
        servedPhase: "intimate",
      }),
    ).toBeNull();
  });

  it("配信フェーズが erotic 以上なら問い直さん", () => {
    expect(
      resolveSubtextEscalationRequest({
        keywordPhase: "conversation",
        hasSustainedForeplay: true,
        servedPhase: "erotic",
      }),
    ).toBeNull();
  });

  // afterglow は「上の段」やのうて別の段。余韻から erotic を問い直したら場面が巻き戻る。
  it("配信フェーズが afterglow なら位置として採らん", () => {
    expect(
      resolveSubtextEscalationRequest({
        keywordPhase: "conversation",
        hasSustainedForeplay: true,
        servedPhase: "afterglow",
      }),
    ).toEqual({ judgeTarget: "user_invitation", target: "intimate" });
  });

  it.each(["erotic", "climax", "afterglow"])("%s のターンはどちらの向きにも問い直さん", (phase) => {
    expect(
      resolveSubtextEscalationRequest({ keywordPhase: phase, hasSustainedForeplay: true }),
    ).toBeNull();
  });
});

// 純粋関数を直しても配線されてへんかったら本番は変わらん。実ハンドラで、
// 送られる問い直しプロンプトがどっちの judge かを見る。
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

const collectClassifierPrompts = async (
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string> => {
  const captured: string[] = [];
  const stub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("openrouter.ai")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: { role: string; content: string }[];
      };
      captured.push((body.messages ?? []).map((m) => m.content).join("\n"));
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "payment required" } }), {
          status: 402,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
  });
  vi.stubGlobal("fetch", stub);

  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages, responseLength: "medium" }),
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
  return captured.join("\n");
};

// erotic_escalation の judge だけが持つ文言。ここが出た＝erotic を狙って問い直した印。
const EROTIC_JUDGE_MARKER = "past foreplay";

describe("実ハンドラの問い直し先", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("前戯 1 ターン目では erotic の judge を投げん", async () => {
    const prompts = await collectClassifierPrompts([
      { role: "user", content: "……近いね。少しだけ、手に触れてもいい？" },
    ]);

    expect(prompts).not.toContain(EROTIC_JUDGE_MARKER);
  });

  it("前戯が続いたら erotic の judge を投げる", async () => {
    const prompts = await collectClassifierPrompts([
      { role: "user", content: "……近いね。少しだけ、手に触れてもいい？" },
      { role: "assistant", content: "指先が触れて、身じろぎする。" },
      { role: "user", content: "髪、かかってる。耳にかけるね。首筋、少し赤くなってる。" },
    ]);

    expect(prompts).toContain(EROTIC_JUDGE_MARKER);
  });
});
