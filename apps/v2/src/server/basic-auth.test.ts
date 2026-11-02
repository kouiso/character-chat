// @vitest-environment node
import { describe, expect, it } from "vitest";

import { preventSharedCaching, requireBasicAuth } from "./basic-auth";

const config = { BASIC_AUTH_USERNAME: "reader", BASIC_AUTH_PASSWORD: "test-only-pass:phrase" };
const authorization = (value: string): string => `Basic ${Buffer.from(value).toString("base64")}`;

describe("Workers 入口の BASIC 認証", () => {
  it.each([
    "/",
    "/chat/example",
    "/assets/main.js",
    "/api/chat/example",
    "/api/chat/example/history",
  ])("%s は認証なしで本文を返さない", async (path) => {
    const response = await requireBasicAuth(new Request(`https://example.com${path}`), config);
    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe("");
    expect(response?.headers.get("www-authenticate")).toContain("Basic");
    expect(response?.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    "Bearer value",
    "Basic !!!",
    "Basic /w==",
    authorization("reader"),
    authorization("reader:wrong"),
    authorization("other:test-only-pass:phrase"),
    `${authorization("reader:test-only-pass:phrase")}, Basic value`,
  ])("不正な資格情報を拒否する: %s", async (header) => {
    const response = await requireBasicAuth(
      new Request("https://example.com", { headers: { authorization: header } }),
      config,
    );
    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe("");
  });

  it.each([
    {},
    { BASIC_AUTH_USERNAME: "reader" },
    { BASIC_AUTH_PASSWORD: "value" },
    { BASIC_AUTH_USERNAME: "reader", BASIC_AUTH_PASSWORD: "" },
    { BASIC_AUTH_USERNAME: "", BASIC_AUTH_PASSWORD: "value" },
    { BASIC_AUTH_USERNAME: "a:b", BASIC_AUTH_PASSWORD: "value" },
  ])("設定不足では公開しない", async (settings) => {
    const response = await requireBasicAuth(new Request("https://example.com"), settings);
    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe("");
  });

  it.each(["HEAD", "OPTIONS"])("%s でも入口の認証を省略しない", async (method) => {
    const response = await requireBasicAuth(
      new Request("https://example.com/assets/app.js", { method }),
      config,
    );
    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe("");
  });

  it("正しい認証だけを通し、パスワード中のコロンを保持する", async () => {
    expect(
      await requireBasicAuth(
        new Request("https://example.com", {
          headers: { authorization: authorization("reader:test-only-pass:phrase") },
        }),
        config,
      ),
    ).toBeNull();
  });

  it("UTF-8 の資格情報を検証する", async () => {
    const settings = { BASIC_AUTH_USERNAME: "読者", BASIC_AUTH_PASSWORD: "試験用" };
    expect(
      await requireBasicAuth(
        new Request("https://example.com", {
          headers: { authorization: authorization("読者:試験用") },
        }),
        settings,
      ),
    ).toBeNull();
  });

  it("認証済みの静的ファイルやSSEも共有キャッシュに残さない", async () => {
    const response = preventSharedCaching(
      new Response("data: hello\n\n", {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "public,max-age=3600",
          vary: "Accept",
        },
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept, Authorization");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("data: hello\n\n");
  });
});
