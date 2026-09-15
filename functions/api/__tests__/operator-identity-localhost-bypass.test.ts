import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";
import { LOCAL_USER_EMAIL } from "../lib/route-context";

// getUserEmail は Host ヘッダを信用せず、LOCAL_AUTH_BYPASS=1 の環境変数のみで
// ローカル開発用の運用者本人を返す。これによりクライアントが偽装可能な
// Host ヘッダを認証判定に使わんようになる。

const ORIGIN = "https://adult-ai-chat.pages.dev";

// Bearer/Basic なし。LOCAL_AUTH_BYPASS の有無だけで認証を切り替える。
const makeEnv = (localAuthBypass: string | undefined = undefined) =>
  ({
    DB: {} as never,
    BUCKET: {} as never,
    OPENROUTER_API_KEY: "",
    NOVITA_API_KEY: "",
    LOCAL_AUTH_BYPASS: localAuthBypass,
  }) as never;

const requestWithHost = (host: string | null, localAuthBypass?: string) =>
  app.request(
    new Request(`${ORIGIN}/api/me`, {
      headers: host === null ? {} : { Host: host },
    }),
    undefined,
    makeEnv(localAuthBypass),
  );

describe("運用者本人扱いのローカル認証バイパス", () => {
  it.each(["localhost", "localhost:8788", "127.0.0.1", "adult-ai-chat.pages.dev"])(
    "LOCAL_AUTH_BYPASS が無ければ Host が %s でも 401",
    async (host) => {
      const response = await requestWithHost(host);
      expect(response.status).toBe(401);
    },
  );

  it("LOCAL_AUTH_BYPASS=1 なら Host ヘッダ無しでも本人として通る", async () => {
    const response = await requestWithHost(null, "1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: LOCAL_USER_EMAIL,
      isLocal: true,
    });
  });

  it("LOCAL_AUTH_BYPASS=1 のとき Host ヘッダの値は無視される", async () => {
    const response = await requestWithHost("attacker.example.com", "1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      email: LOCAL_USER_EMAIL,
      isLocal: true,
    });
  });

  it("LOCAL_AUTH_BYPASS の値が 1 以外ならバイパスしない", async () => {
    const response = await requestWithHost("localhost", "true");
    expect(response.status).toBe(401);
  });
});
