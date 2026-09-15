import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../[[route]]";

// AGENTS.md CHAT-5 の機構。very_long の指示に段落数・文数・段落あたり字数のノルマを
// 戻させない。文字列の綴りやのうて**数量そのもの**を禁じる — 「16段落」を「16パラグラフ」に
// 書き換えただけで通ってしまう綴り一致では ratchet にならん。
//
// なぜ禁じるか: ノルマは「何を書くか」を一つも与えんまま量だけ要求する。実測
// (2026-08-16 の 9ターン通し) では climax ターンの 13 段落が、鞄の紐・コーヒーカップ・
// 花びら型の栞・靴の中で丸まる爪先・窓の外の雲で埋まり、同じ文が 2 回そのまま出た。
// 何を書くかは buildPhaseBeatSheet がキャラ自身のエスカレート連鎖から出す。

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

// 組み立て済みの全文で見る。lengthDirective 単体を見ると、ユーザー発言末尾へ差し込まれる
// lengthUserReinforcement を素通しする（フロアはそっちへ移る）。
const assembleVeryLongDirective = async (
  scenePhase: "conversation" | "intimate" | "erotic" | "climax" | "afterglow",
): Promise<string> => {
  const captured = captureOpenRouterFetch();
  const response = await app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "そのまま続けて、もっと近くに来てほしい" }],
        responseLength: "very_long",
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
  expect(captured.length).toBeGreaterThan(0);
  return captured[0].messages.map((m) => m.content).join("\n");
};

const PHASES = ["conversation", "intimate", "erotic", "climax", "afterglow"] as const;

describe("very_long の指示に分量ノルマを戻させない (CHAT-5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 「N段落以上/ずつ/を目安」だけを禁じる。「一度使った表現は最低3段落経てから再使用」は
  // 間隔の規則で、量を要求しとらんので残す（水増しの原因やのうて反復の抑止）。
  it.each(PHASES)("%s: 段落数のノルマが無い", async (phase) => {
    const assembled = await assembleVeryLongDirective(phase);
    expect(assembled).not.toMatch(/\d+\s*段落\s*(?:以上|ずつ|程度|前後|を目安)/);
  });

  // 「字」を除くのは「最低文字数は1440字」がフロアの正本として1回だけ出るため。
  it.each(PHASES)("%s: 文数のノルマが無い", async (phase) => {
    const assembled = await assembleVeryLongDirective(phase);
    expect(assembled).not.toMatch(/\d+\s*文(?!字)/);
  });

  // フロアの数値が散ると、どこかを直した時に別の場所と食い違う（#1431）。
  // very_long では lengthDirective 本体と、ユーザー発言末尾へ差し込む
  // lengthUserReinforcement の 2 箇所だけに置く。末尾差し込みは実測(#1344)で
  // 実際に長さを保っとる経路なので消さん。
  it("フロアの字数は組み立て済み全文で2箇所までしか出ん", async () => {
    const assembled = await assembleVeryLongDirective("erotic");
    const floorMatch = /最低文字数は(\d+)字/.exec(assembled);
    expect(floorMatch).not.toBeNull();
    const floor = floorMatch?.[1] ?? "";
    expect(assembled.match(new RegExp(`${floor}字`, "g")) ?? []).toHaveLength(2);
  });

  // <inner> の制約だけは残す。可視文字数に入らんので、長いと純粋な重りになる。
  it("<inner> の 1ブロック・120字以内は残っとる", async () => {
    const assembled = await assembleVeryLongDirective("erotic");
    expect(assembled).toContain("120字以内");
    expect(assembled).toContain("1つだけ");
  });
});
