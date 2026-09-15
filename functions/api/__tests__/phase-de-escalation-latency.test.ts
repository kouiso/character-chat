import { describe, expect, it } from "vitest";

import { classifyPhaseDeEscalation } from "../lib/phase-de-escalation-classifier";

describe("問い直しの待ち時間の上限", () => {
  it("全部タイムアウトしても既定の上限を超えん", async () => {
    const hanging: typeof fetch = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    const startedAt = Date.now();
    const result = await classifyPhaseDeEscalation({
      messages: [{ role: "user", content: "元気出して" }],
      keywordPhase: "climax",
      fallbackPhase: "erotic",
      apiKey: "k",
      appOrigin: "https://example.test",
      fetchImpl: hanging,
    });
    const elapsed = Date.now() - startedAt;

    expect(result.deEscalate).toBe(false);
    // #946 の上限10秒から、#951 のヘッジ経路の1文字目 ~6.9秒 を引いた残りが ~3.1秒。
    // 問い直しはこの残りに収まらんとあかんので、上限を 2.5秒 で固定する。
    expect(elapsed).toBeLessThan(2500);
  }, 20000);
});
