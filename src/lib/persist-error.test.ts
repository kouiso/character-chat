import { describe, expect, it } from "vitest";

import { isAmbiguousPersistError } from "./persist-error";

describe("isAmbiguousPersistError", () => {
  // 中断はサーバ側の INSERT が終わっているかを決めない。D1 に触ってはいけない。
  it.each([
    ["AbortSignal.timeout", Object.assign(new Error("signal timed out"), { name: "TimeoutError" })],
    ["manual abort", Object.assign(new Error("The operation was aborted"), { name: "AbortError" })],
    ["offline fetch", new TypeError("Failed to fetch")],
    ["safari offline", new TypeError("Load failed")],
    ["reset socket", new Error("connection reset by peer")],
  ])("treats %s as ambiguous", (_label, error) => {
    expect(isAmbiguousPersistError(error)).toBe(true);
  });

  // HTTP のエラー応答は結果が確定しているので、従来どおりロールバックしてよい。
  it.each([
    ["client error", new Error("create message failed: 400")],
    ["server error", new Error("create message failed: 500")],
    ["delete failure", new Error("delete message failed: 409")],
  ])("treats %s as definite", (_label, error) => {
    expect(isAmbiguousPersistError(error)).toBe(false);
  });

  it("does not treat non-errors as ambiguous", () => {
    expect(isAmbiguousPersistError("boom")).toBe(false);
    expect(isAmbiguousPersistError(null)).toBe(false);
  });
});
