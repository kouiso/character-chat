import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureAuthToken } from "./auth-session";

const AUTH_TOKEN_KEY = "auth_token";

const makeToken = (exp: number): string => {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
};

describe("ensureAuthToken", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("保存済み token が十分新しければ fetch しない", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    localStorage.setItem(AUTH_TOKEN_KEY, makeToken(1_000_000));
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(ensureAuthToken()).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token が古ければ session API から取得して保存する", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "new-token" }), { status: 200 }),
    );

    await expect(ensureAuthToken()).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith("/api/auth/session", {
      method: "POST",
      credentials: "include",
    });
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe("new-token");
  });

  it("session API が失敗した場合は保存しない", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(ensureAuthToken()).resolves.toBe(false);

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it("session API の body に token がなければ保存しない", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "" }), { status: 200 }),
    );

    await expect(ensureAuthToken()).resolves.toBe(false);

    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it("壊れた token と fetch 例外を安全に扱う", async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, "broken-token");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));

    await expect(ensureAuthToken()).resolves.toBe(false);
  });

  it("localStorage が書けなくても ensureAuthToken はセッション確立として返す", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "new-token" }), { status: 200 }),
    );

    await expect(ensureAuthToken()).resolves.toBe(true);
  });
});
