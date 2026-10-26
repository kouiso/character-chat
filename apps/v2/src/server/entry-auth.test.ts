// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkBasicAuth } from "./entry-auth";

const credentials = { BASIC_AUTH_USER: "local-user", BASIC_AUTH_PASS: "local-only-pass:colon" };
const valid = `Basic ${btoa("local-user:local-only-pass:colon")}`;
const invalidHeaders = [
  undefined,
  `Basic ${btoa("local-user:wrong")}`,
  `Basic ${btoa("wrong:local-only-pass:colon")}`,
  "Basic !!!not-base64!!!",
  `Basic ${btoa("no-colon")}`,
  "Bearer synthetic",
  "Basic ",
];
const methods = ["GET", "POST", "HEAD", "OPTIONS"];
const paths = [
  "/",
  "/chat/synthetic",
  "/api/chat/synthetic/history",
  "/api/chat/synthetic",
  "/assets/app.js",
];

describe("entry BASIC gate", () => {
  for (const method of methods) {
    for (const path of paths) {
      it(`${method} ${path} rejects every malformed or missing credential`, async () => {
        for (const authorization of invalidHeaders) {
          const request = new Request(`https://local.invalid${path}`, {
            method,
            headers: authorization ? { Authorization: authorization } : {},
          });
          const result = checkBasicAuth(request, credentials);
          expect(result?.status).toBe(401);
          expect(result?.headers.get("WWW-Authenticate")).toContain('Basic realm="adult-ai-chat"');
          expect(result?.headers.get("Cache-Control")).toBe("no-store");
          expect(await result?.text()).toBe("");
        }
      });

      it(`${method} ${path} fails closed before credential parsing when secrets are missing`, () => {
        for (const env of [
          {},
          { BASIC_AUTH_USER: "local-user" },
          { BASIC_AUTH_PASS: "local-only-pass:colon" },
          { ...credentials, BASIC_AUTH_USER: "" },
          { ...credentials, BASIC_AUTH_USER: "  " },
          { ...credentials, BASIC_AUTH_PASS: "" },
        ]) {
          for (const authorization of [undefined, valid, "Basic !!!"]) {
            const result = checkBasicAuth(
              new Request(`https://local.invalid${path}`, {
                method,
                headers: authorization ? { Authorization: authorization } : {},
              }),
              env,
            );
            expect(result?.status).toBe(503);
            expect(result?.headers.get("Cache-Control")).toBe("no-store");
            expect(result?.headers.has("WWW-Authenticate")).toBe(false);
          }
        }
      });
    }
  }

  it.each(methods)("allows valid credentials with a colon in the password on %s", (method) => {
    expect(
      checkBasicAuth(
        new Request("https://local.invalid/", { method, headers: { Authorization: valid } }),
        credentials,
      ),
    ).toBeUndefined();
  });
});
