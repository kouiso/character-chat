import { afterEach, describe, expect, it, vi } from "vitest";

import { randomUUID } from "./uuid";

const originalCrypto = globalThis.crypto;

describe("randomUUID", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  });

  it("crypto.randomUUID があればそれを使う", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "crypto-id" },
    });

    expect(randomUUID()).toBe("crypto-id");
  });

  it("crypto.randomUUID がない環境では UUID v4 形式を生成する", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(randomUUID()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
