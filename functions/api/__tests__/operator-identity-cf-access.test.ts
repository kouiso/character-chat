import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";
import { LOCAL_USER_EMAIL } from "../lib/route-context";

// 本番 Pages は Cloudflare Access が入口で Google 認証を済ませるので、
// V1_CF_ACCESS=1 の環境では Basic/Bearer 無しでも本人として解決する。
// preview デプロイは Access の外なので flag を立てん限り 401 のままにする。

const ORIGIN = "https://adult-ai-chat.pages.dev";

const makeEnv = (cfAccess: string | undefined = undefined) =>
  ({
    DB: {} as never,
    BUCKET: {} as never,
    OPENROUTER_API_KEY: "",
    NOVITA_API_KEY: "",
    V1_CF_ACCESS: cfAccess,
  }) as never;

const request = (cfAccess?: string) =>
  app.request(new Request(`${ORIGIN}/api/me`), undefined, makeEnv(cfAccess));

describe("Cloudflare Access 配下の本人解決", () => {
  it("V1_CF_ACCESS=1 なら認証ヘッダ無しでも本人として通る", async () => {
    const response = await request("1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: LOCAL_USER_EMAIL,
      isLocal: true,
    });
  });

  it("V1_CF_ACCESS が無ければ従来どおり 401", async () => {
    const response = await request();
    expect(response.status).toBe(401);
  });

  it("V1_CF_ACCESS の値が 1 以外ならバイパスしない", async () => {
    const response = await request("true");
    expect(response.status).toBe(401);
  });
});
