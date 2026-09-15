// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  collectQualityAttemptChat,
  raceFirstTokenCandidates,
  type FirstTokenCandidateOutcome,
} from "../lib/route-context";

// 読み手が居らんようになった後も生成を続けとった。
//
// 実測（2026-08-19 phase42・測定 worker のログ）: climax の 2 ターンで
//   OpenRouter request failed (deepseek) client_disconnect
//   → upstream stream transient; retrying {to: euryale}
//   → client_disconnect ×4（euryale / deepseek / qwen / hermes）
//   → turn generation budget exhausted; returning repaired best attempt
// が起きて、フロア 900 字に対して 452 字（Downer）・807 字（Sakura）が出荷された。
//
// 原因は分類。クライアント切断は status を持たん失敗として返るので
// shouldRecoverTooShortEscalationUpstreamError の `status === undefined` に当たり、
// 「一過性の上流障害」として復旧チェーンが最後まで歩かれる。
// raceFirstTokenCandidates も同じで、切断済みでも次候補を**起動してから** abort しとった。
//
// clientSignal は既に両方の関数へ渡っとる。足すもんは無い。見てへんかっただけ。

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HEDGE_MS = 20;

describe("raceFirstTokenCandidates: 読み手が居らんなら候補を起動せん", () => {
  it("最初から切断済みなら 1 本も起動せん", async () => {
    const started: string[] = [];
    const controller = new AbortController();
    controller.abort();

    const result = await raceFirstTokenCandidates(
      ["primary", "secondary", "tertiary"],
      "primary",
      controller.signal,
      async (model): Promise<FirstTokenCandidateOutcome> => {
        started.push(model);
        return { kind: "next", lastResponse: null, usedModel: model };
      },
      HEDGE_MS,
    );

    expect(started).toEqual([]);
    expect(result.response.status).toBe(503);
  });

  it("走っとる最中に切断されたら、次の候補へ進まん", async () => {
    const started: string[] = [];
    const controller = new AbortController();

    const result = await raceFirstTokenCandidates(
      ["primary", "secondary", "tertiary"],
      "primary",
      controller.signal,
      async (model): Promise<FirstTokenCandidateOutcome> => {
        started.push(model);
        // 1 本目が走っとる間に読み手が離れる。
        controller.abort();
        await sleep(1);
        return { kind: "next", lastResponse: null, usedModel: model };
      },
      HEDGE_MS,
    );

    expect(started).toEqual(["primary"]);
    expect(result.response.status).toBe(503);
  });
});

describe("collectQualityAttemptChat: 切断後に復旧チェーンを歩かん", () => {
  it("切断で落ちた試行を一過性の上流障害として引き直さん", async () => {
    const models: string[] = [];
    const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("openrouter.ai")) return new Response("{}", { status: 200 });
      models.push(String(JSON.parse(String(init?.body ?? "{}")).model));
      throw new DOMException("client_disconnect", "AbortError");
    });
    vi.stubGlobal("fetch", stub);

    const controller = new AbortController();
    controller.abort();

    try {
      const collected = await collectQualityAttemptChat(
        { OPENROUTER_API_KEY: "k", APP_ORIGIN: "https://example.test" } as never,
        "deepseek/deepseek-chat",
        "climax",
        [{ role: "user", content: "つづき" }],
        controller.signal,
        { temperature: 0.8, max_tokens: 1200 },
        0,
        5000,
      );

      expect(collected.ok).toBe(false);
      // 切断済みなので上流は 1 回も叩かん。叩いても 1 回で止まる。
      expect(models.length).toBeLessThanOrEqual(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
