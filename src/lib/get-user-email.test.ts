import { describe, expect, it } from "vitest";

import { getUserEmail } from "../../functions/api/[[route]]";

const createContext = (
  headers: Record<string, string | undefined>,
  env: Record<string, string | undefined> = {},
) => ({
  req: { header: (key: string) => headers[key] },
  env: {
    AUTH_TOKEN: env.AUTH_TOKEN ?? "expected-token",
    AUTH_SIGNING_KEY: env.AUTH_SIGNING_KEY,
    BASIC_AUTH_USER: env.BASIC_AUTH_USER,
    BASIC_AUTH_PASS: env.BASIC_AUTH_PASS,
    LOCAL_AUTH_BYPASS: env.LOCAL_AUTH_BYPASS,
  },
});

describe("getUserEmail", () => {
  it("returns the shared local identity when the bearer token matches AUTH_TOKEN", async () => {
    await expect(
      getUserEmail(createContext({ Authorization: "Bearer expected-token" })),
    ).resolves.toBe("sukererion@gmail.com");
  });

  it("returns null when the bearer token does not match AUTH_TOKEN", async () => {
    await expect(
      getUserEmail(createContext({ Authorization: "Bearer wrong-token" })),
    ).resolves.toBe(null);
  });

  it("authorizes API requests with Basic auth as the single operator", async () => {
    await expect(
      getUserEmail(
        createContext(
          { Authorization: `Basic ${btoa("user:pass")}` },
          { BASIC_AUTH_USER: "user", BASIC_AUTH_PASS: "pass" },
        ),
      ),
    ).resolves.toBe("sukererion@gmail.com");
  });

  it("does not trust the Host header for local authentication bypass", async () => {
    await expect(getUserEmail(createContext({ Host: "localhost" }))).resolves.toBe(null);
  });

  it("returns the shared local identity when LOCAL_AUTH_BYPASS is set to 1", async () => {
    await expect(getUserEmail(createContext({}, { LOCAL_AUTH_BYPASS: "1" }))).resolves.toBe(
      "sukererion@gmail.com",
    );
  });

  it("ignores LOCAL_AUTH_BYPASS values other than 1", async () => {
    await expect(getUserEmail(createContext({}, { LOCAL_AUTH_BYPASS: "true" }))).resolves.toBe(
      null,
    );
  });
});
