// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestOpenRouterChat } from "../lib/route-context";

// 推論モデルは本文の前に思考トークンを吐く。読み手には 1 文字も届かんのに、
// 課金され、1 文字目までの待ち時間になる。
//
// 実測 2026-08-19（アプリと同じ約 17,000 字の system を送って n=5・中央値）:
//   qwen3.8-27b 素          TTFT 37.4 秒
//   qwen3.8-27b 推論オフ    TTFT  1.46 秒
// 現行のルーティング先（deepseek / qwen-2.5-72b / euryale / hermes / llama）は
// この指定を全部 HTTP 200 で受ける。推論を持たんモデルでは無視されるだけ。
//
// grok-4.6 だけは "Reasoning is mandatory for this endpoint" で 400 を返すが、
// ルーティング先やない。

const captureBody = () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("openrouter.ai")) {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ error: { message: "payment required" } }), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return bodies;
};

describe("チャット生成は思考トークンを買わん", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("推論を切る指定が本文へ乗る", async () => {
    const bodies = captureBody();

    await requestOpenRouterChat(
      "k",
      "https://example.test",
      "qwen/qwen3.8-27b",
      "erotic",
      [{ role: "user", content: "つづき" }],
      undefined,
      { temperature: 0.9, max_tokens: 1200 },
      true,
      0,
    );

    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0].reasoning).toEqual({ enabled: false });
  });
});
