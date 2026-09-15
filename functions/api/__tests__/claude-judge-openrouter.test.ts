import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLAUDE_JUDGE_MODEL, claudeJudgeQuality } from "../[[route]]";

const openRouterBody = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const runJudge = () =>
  claudeJudgeQuality("現在の応答", "前回の応答", "erotic", "or-key", "https://x");

describe("claudeJudgeQuality via OpenRouter", () => {
  it("issues an OpenAI-compatible request to OpenRouter with the confirmed model id", async () => {
    fetchSpy.mockResolvedValue(openRouterBody("PASS"));

    await runJudge();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer or-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(CLAUDE_JUDGE_MODEL);
    expect(CLAUDE_JUDGE_MODEL).toBe("anthropic/claude-haiku-4.5");
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    // 判定基準と verdict の文法は user prompt 側のまま。system は枠の復元だけ。
    expect(body.messages[1].content).toContain("If ALL five are YES, respond with exactly: PASS");
    // #1231: 官能描写の具体性も既存の毎ターン判定に相乗りさせる（追加APIコール無し）
    expect(body.messages[1].content).toContain("SENSORY");
    // #1383: 世界観・シーン設定の一貫性判定も相乗りさせる。
    expect(body.messages[1].content).toContain("PLAUSIBLE");
  });

  it("fails with the SENSORY criterion when the judge flags it", async () => {
    fetchSpy.mockResolvedValue(openRouterBody("FAIL:SENSORY:抽象語だけで具体描写が無い"));
    // 敵対レビュー #1236 指摘・5巡目: SENSORY は quality-retry-hints.ts の
    // sensual_abstract 専用ヒントへ回す（parseClaudeJudgeVerdict 参照）。
    expect(await runJudge()).toEqual({
      pass: false,
      reason: "claude-judge: 抽象語だけで具体描写が無い",
      category: "sensual_abstract",
      failedCheck: "claude-judge:SENSORY",
      ran: true,
    });
  });

  it("passes when the judge answers PASS", async () => {
    fetchSpy.mockResolvedValue(openRouterBody("PASS"));
    expect(await runJudge()).toEqual({ pass: true, ran: true });
  });

  it("fails when the judge answers FAIL", async () => {
    fetchSpy.mockResolvedValue(openRouterBody("FAIL:EXPLICIT:描写が曖昧"));
    expect(await runJudge()).toEqual({
      pass: false,
      reason: "claude-judge: 描写が曖昧",
      category: "other",
      failedCheck: "claude-judge:EXPLICIT",
      ran: true,
    });
  });

  it("marks a non-2xx OpenRouter response as an outage, not a pass", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 502, statusText: "Bad Gateway" }));
    expect(await runJudge()).toEqual({ pass: true, ran: null });
  });

  it("marks an auth failure as an outage and logs a distinguishable event", async () => {
    fetchSpy.mockResolvedValue(new Response("bad key", { status: 401 }));
    const errorSpy = vi.mocked(console.error);

    expect(await runJudge()).toEqual({ pass: true, ran: null });

    const line = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(line).toContain("[quality][judge-unavailable]");
    expect(line).toContain('"reason":"auth_failed"');
  });

  it("classifies 403 as forbidden, not as a revoked key", async () => {
    // OpenRouter は資格情報不正=401 / moderation 拒否=403。混ぜると鍵ローテへ誤誘導する。
    fetchSpy.mockResolvedValue(new Response("moderated", { status: 403 }));
    const errorSpy = vi.mocked(console.error);

    expect(await runJudge()).toEqual({ pass: true, ran: null });

    const line = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(line).toContain('"reason":"forbidden"');
    expect(line).not.toContain('"reason":"auth_failed"');
  });

  it("bounds the OpenRouter call with an abort signal", async () => {
    fetchSpy.mockResolvedValue(openRouterBody("PASS"));

    await runJudge();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails open with ran:null when the judge request times out", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchSpy.mockRejectedValue(timeout);
    const errorSpy = vi.mocked(console.error);

    expect(await runJudge()).toEqual({ pass: true, ran: null });

    const line = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(line).toContain('"reason":"timeout"');
  });

  it("marks an unparseable body as an outage, not a pass", async () => {
    fetchSpy.mockResolvedValue(openRouterBody("たぶん合格やと思います"));
    expect(await runJudge()).toEqual({ pass: true, ran: null });
  });

  it("marks an Anthropic-shaped body (no choices) as an outage", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ text: "PASS" }] }), { status: 200 }),
    );
    expect(await runJudge()).toEqual({ pass: true, ran: null });
  });

  it("marks a missing API key as an outage (ran:null), never as an intentional skip", async () => {
    const result = await claudeJudgeQuality("現在の応答", undefined, "erotic", undefined);

    expect(result).toEqual({ pass: true, ran: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    const line = vi
      .mocked(console.error)
      .mock.calls.map((call) => String(call[0]))
      .join("\n");
    expect(line).toContain('"reason":"missing_key"');
  });

  it("keeps ran:false for a phase the judge intentionally does not review", async () => {
    const result = await claudeJudgeQuality("現在の応答", undefined, "conversation", "or-key");

    expect(result).toEqual({ pass: true, ran: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
