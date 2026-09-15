import { describe, expect, it } from "vitest";

import { shouldFallbackToNextModel } from "../[[route]]";

// スライス4: OpenRouter の upstream transient で次モデル退避が発火するかの回帰テスト。
// 429 は rate-limit で、model.ts のフェーズ退避コメント「upstream 429 は退避連鎖が受け止める」の
// 実装本体。以前は 429 が述語に含まれず、クライアントへ素通しされていた。
describe("shouldFallbackToNextModel", () => {
  it("429/502/503/504 の upstream transient で次モデルへ退避する", () => {
    for (const status of [429, 502, 503, 504]) {
      expect(shouldFallbackToNextModel(status, "")).toBe(true);
    }
  });

  it("402(与信切れ) は次モデル退避しない（max_tokens 引き下げ再試行の担当）", () => {
    expect(shouldFallbackToNextModel(402, "insufficient credits")).toBe(false);
  });

  it("200/400 等は退避しない", () => {
    expect(shouldFallbackToNextModel(200, "")).toBe(false);
    expect(shouldFallbackToNextModel(400, "bad request")).toBe(false);
  });

  it("body のモデル非対応パターンでは status に関わらず退避する", () => {
    expect(shouldFallbackToNextModel(400, "model_not_available")).toBe(true);
    expect(shouldFallbackToNextModel(404, "No endpoints found")).toBe(true);
  });
});
