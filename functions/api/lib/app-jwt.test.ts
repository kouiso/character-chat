import { describe, expect, it } from "vitest";

import { verifyAppJwt } from "./app-jwt";

const KEY = "test-signing-key";

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

// [[route]].ts の signAppJwt と同一方式（HS256）でテスト用トークンを生成する。
// header を差し替えられるようにして alg 混同攻撃（alg:none 等）の拒否も検証する。
const sign = async (
  payload: Record<string, unknown>,
  key = KEY,
  headerObject: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): Promise<string> => {
  const header = base64url(new TextEncoder().encode(JSON.stringify(headerObject)));
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const input = `${header}.${body}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
};

const future = (): number => Math.floor(Date.now() / 1000) + 3600;
const past = (): number => Math.floor(Date.now() / 1000) - 3600;

describe("verifyAppJwt", () => {
  it("returns the email for a valid token", async () => {
    const token = await sign({ email: "a@b.com", exp: future() });
    expect(await verifyAppJwt(`Bearer ${token}`, KEY)).toBe("a@b.com");
  });

  it("returns null when the signing key mismatches", async () => {
    const token = await sign({ email: "a@b.com", exp: future() }, "other-key");
    expect(await verifyAppJwt(`Bearer ${token}`, KEY)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const token = await sign({ email: "a@b.com", exp: past() });
    expect(await verifyAppJwt(`Bearer ${token}`, KEY)).toBeNull();
  });

  it("returns null for a tampered payload", async () => {
    const token = await sign({ email: "a@b.com", exp: future() });
    const [header, , sig] = token.split(".");
    const forged = base64url(
      new TextEncoder().encode(JSON.stringify({ email: "evil@b.com", exp: future() })),
    );
    expect(await verifyAppJwt(`Bearer ${header}.${forged}.${sig}`, KEY)).toBeNull();
  });

  it("returns null without a Bearer prefix", async () => {
    const token = await sign({ email: "a@b.com", exp: future() });
    expect(await verifyAppJwt(token, KEY)).toBeNull();
  });

  it("returns null when the signing key is missing", async () => {
    const token = await sign({ email: "a@b.com", exp: future() });
    expect(await verifyAppJwt(`Bearer ${token}`, undefined)).toBeNull();
  });

  it("returns null when the email claim is absent", async () => {
    const token = await sign({ exp: future() });
    expect(await verifyAppJwt(`Bearer ${token}`, KEY)).toBeNull();
  });

  it("returns null for a non-HS256 alg even with a valid HMAC signature", async () => {
    // alg:none だが HMAC 署名は正当なトークン。alg 混同攻撃を防ぐため拒否されねばならない。
    const token = await sign({ email: "a@b.com", exp: future() }, KEY, {
      alg: "none",
      typ: "JWT",
    });
    expect(await verifyAppJwt(`Bearer ${token}`, KEY)).toBeNull();
  });

  it("returns null for malformed tokens", async () => {
    expect(await verifyAppJwt("Bearer not.a.jwt", KEY)).toBeNull();
    expect(await verifyAppJwt("Bearer abc", KEY)).toBeNull();
    expect(await verifyAppJwt(undefined, KEY)).toBeNull();
    expect(await verifyAppJwt(null, KEY)).toBeNull();
  });
});
