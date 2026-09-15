import { afterEach, describe, expect, it, vi } from "vitest";

import { withDeadline } from "./with-deadline";

describe("withDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the value when the task settles in time", async () => {
    await expect(withDeadline(Promise.resolve("ok"), 1_000, "task")).resolves.toBe("ok");
  });

  it("passes the task's own failure through unchanged", async () => {
    await expect(withDeadline(Promise.reject(new Error("boom")), 1_000, "task")).rejects.toThrow(
      "boom",
    );
  });

  // 一時停止した mutation は解決も棄却もしない。待つ側だけは必ず返す。
  it("rejects with a TimeoutError when the task never settles", async () => {
    vi.useFakeTimers();
    const settled = withDeadline(new Promise<void>(() => undefined), 5_000, "row persist").catch(
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(5_000);

    const error = (await settled) as Error;
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toContain("row persist timed out after 5000ms");
  });
});
