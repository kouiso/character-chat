import { describe, expect, it } from "vitest";

import { app } from "../[[route]]";
import { APP_AUTH_COOKIE, LOCAL_USER_EMAIL, signAppJwt } from "../lib/route-context";

// functions/api/routes/auth.ts（GET /api/me, POST /api/auth/basic-login,
// POST /api/auth/session）の HTTP 層を検証する。
// 署名/検証そのものは lib/app-jwt.test.ts が持つので、ここでは触らん。
// ここで守るのは「誰を本人と認めるか」と「応答に何を出すか」の境界。

const SIGNING_KEY = "test-signing-key";
const AUTH_TOKEN = "test-auth-token";
const BASIC_USER = "admin";
const BASIC_PASS = "s3cret-pass";

// getUserEmail は Host が localhost やと無条件で本人扱いする（route-context.ts:1735）。
// 認証境界のテストがその抜け道で素通りせんよう、必ず本番相当のホストで叩く。
const ORIGIN = "https://adult-ai-chat.pages.dev";

type EnvOverride = Partial<{
  AUTH_TOKEN: string;
  AUTH_SIGNING_KEY: string | undefined;
  BASIC_AUTH_USER: string | undefined;
  BASIC_AUTH_PASS: string | undefined;
}>;

const makeEnv = (override: EnvOverride = {}) => ({
  AUTH_TOKEN,
  AUTH_SIGNING_KEY: SIGNING_KEY,
  BASIC_AUTH_USER: BASIC_USER,
  BASIC_AUTH_PASS: BASIC_PASS,
  DB: {} as never,
  BUCKET: {} as never,
  OPENROUTER_API_KEY: "",
  NOVITA_API_KEY: "",
  ...override,
});

const request = (path: string, init: RequestInit = {}, override: EnvOverride = {}) =>
  app.request(`${ORIGIN}/api${path}`, init, makeEnv(override));

const postForm = (path: string, fields: Record<string, string>, override: EnvOverride = {}) =>
  request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    override,
  );

// /auth/session の応答は Hono の型推論では unknown に落ちるため、読み側で形を与える。
const readJson = async <T>(res: { json: () => Promise<unknown> }): Promise<T> =>
  (await res.json()) as T;

const base64url = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// exp や alg を任意に指定した JWT を組む。期限切れ・alg 混同を HTTP 層から確かめるため。
const forgeJwt = async (options: {
  email: string;
  exp: number;
  alg?: string;
  signingKey?: string;
  breakSignature?: boolean;
}): Promise<string> => {
  const encoder = new TextEncoder();
  const header = base64url(
    encoder.encode(JSON.stringify({ alg: options.alg ?? "HS256", typ: "JWT" })),
  );
  const payload = base64url(
    encoder.encode(JSON.stringify({ email: options.email, iat: 1, exp: options.exp })),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(options.signingKey ?? SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  const encoded = base64url(signature);
  return `${signingInput}.${options.breakSignature ? `${encoded.slice(0, -2)}AA` : encoded}`;
};

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;
const NINETY_DAYS_SEC = 90 * 24 * 60 * 60;
const LOGIN_FAILED_HTML =
  '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<p>Login failed</p><p><a href="/">Back</a></p>';

describe("GET /api/me", () => {
  it("資格情報が一切無ければ 401 と unauthorized を返す", async () => {
    const res = await request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("有効なアプリ JWT の Bearer で 200 と email/logoutUrl/isLocal を返す", async () => {
    const token = await signAppJwt(LOCAL_USER_EMAIL, SIGNING_KEY);
    const res = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    // logoutUrl は CF Access 廃止後も null 固定でクライアントが分岐に使う。
    expect(await res.json()).toEqual({
      email: LOCAL_USER_EMAIL,
      logoutUrl: null,
      isLocal: true,
    });
  });

  it("Bearer を付けられん初回遷移でも app_auth Cookie で本人を解決する", async () => {
    const token = await signAppJwt(LOCAL_USER_EMAIL, SIGNING_KEY);
    const res = await request("/me", {
      headers: { Cookie: `${APP_AUTH_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: LOCAL_USER_EMAIL });
  });

  it("共有 AUTH_TOKEN の Bearer も本人として通す", async () => {
    const res = await request("/me", { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: LOCAL_USER_EMAIL });
  });

  it("Basic 資格情報だけでも本人として通す", async () => {
    const res = await request("/me", {
      headers: { Authorization: `Basic ${btoa(`${BASIC_USER}:${BASIC_PASS}`)}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: LOCAL_USER_EMAIL });
  });

  it("別の鍵で署名された JWT は 401（鍵取り違えを本人扱いせん）", async () => {
    const token = await signAppJwt(LOCAL_USER_EMAIL, "attacker-signing-key");
    const res = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("署名だけ差し替えた JWT は 401", async () => {
    const token = await forgeJwt({
      email: LOCAL_USER_EMAIL,
      exp: FUTURE_EXP,
      breakSignature: true,
    });
    const res = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("期限切れ JWT は 401（未提示扱いで素通りさせん）", async () => {
    const token = await forgeJwt({ email: LOCAL_USER_EMAIL, exp: 1_000_000 });
    const res = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("期限切れ Cookie も 401（Cookie 経路だけ緩まん）", async () => {
    const token = await forgeJwt({ email: LOCAL_USER_EMAIL, exp: 1_000_000 });
    const res = await request("/me", { headers: { Cookie: `${APP_AUTH_COOKIE}=${token}` } });
    expect(res.status).toBe(401);
  });

  it("alg を HS256 以外にした JWT は 401（alg 混同）", async () => {
    const token = await forgeJwt({ email: LOCAL_USER_EMAIL, exp: FUTURE_EXP, alg: "none" });
    const res = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("三分割になっとらん Bearer は 401", async () => {
    const res = await request("/me", { headers: { Authorization: "Bearer not-a-jwt" } });
    expect(res.status).toBe(401);
  });

  it("AUTH_SIGNING_KEY 未設定なら過去に発行された JWT でも 401", async () => {
    const token = await signAppJwt(LOCAL_USER_EMAIL, SIGNING_KEY);
    const res = await request(
      "/me",
      { headers: { Authorization: `Bearer ${token}` } },
      { AUTH_SIGNING_KEY: undefined, AUTH_TOKEN: "", BASIC_AUTH_USER: undefined },
    );
    expect(res.status).toBe(401);
  });

  it("LOCAL_USER_EMAIL 以外の JWT では isLocal が false になる", async () => {
    const token = await signAppJwt("intruder@example.com", SIGNING_KEY);
    const res = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "intruder@example.com",
      logoutUrl: null,
      isLocal: false,
    });
  });
});

describe("POST /api/auth/basic-login", () => {
  it("正しい資格情報のフォーム送信は 303 で / へ戻し、本文を持たん", async () => {
    const res = await postForm("/auth/basic-login", {
      username: BASIC_USER,
      password: BASIC_PASS,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("発行する Set-Cookie は HttpOnly/Secure/SameSite=Lax かつ 90 日", async () => {
    const res = await postForm("/auth/basic-login", {
      username: BASIC_USER,
      password: BASIC_PASS,
    });
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie.startsWith(`${APP_AUTH_COOKIE}=`)).toBe(true);
    // XSS でトークンを抜かれん / 平文で飛ばさん / CSRF 面を絞る、の 3 点が同時に要る。
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${NINETY_DAYS_SEC}`);
  });

  it("Accept: application/json なら 200 で token と email を返し、Cookie も同時に張る", async () => {
    const res = await request("/auth/basic-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ username: BASIC_USER, password: BASIC_PASS }).toString(),
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ token: string; email: string }>(res);
    expect(Object.keys(body).sort()).toEqual(["email", "token"]);
    expect(body.email).toBe(LOCAL_USER_EMAIL);
    expect(body.token.split(".")).toHaveLength(3);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // localStorage 用に返す token と Cookie の値が食い違うと片方だけ失効して事故る。
    expect(res.headers.get("Set-Cookie")).toContain(`${APP_AUTH_COOKIE}=${body.token}`);
  });

  it("ログインで受け取った token はそのまま /api/me で通る", async () => {
    const login = await request("/auth/basic-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ username: BASIC_USER, password: BASIC_PASS }).toString(),
    });
    const { token } = await readJson<{ token: string }>(login);
    const me = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: LOCAL_USER_EMAIL });
  });

  it("パスワード違いは 401 の HTML を返し、Cookie を張らん", async () => {
    const res = await postForm("/auth/basic-login", {
      username: BASIC_USER,
      password: "wrong-pass",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe(LOGIN_FAILED_HTML);
  });

  it("ユーザ名違いとパスワード違いの応答が完全に同一（利用者の列挙を許さん）", async () => {
    const wrongPass = await postForm("/auth/basic-login", {
      username: BASIC_USER,
      password: "wrong-pass",
    });
    const unknownUser = await postForm("/auth/basic-login", {
      username: "nobody",
      password: BASIC_PASS,
    });
    expect(unknownUser.status).toBe(wrongPass.status);
    expect(await unknownUser.text()).toBe(await wrongPass.text());
    // ヘッダ差分でも「ユーザ名は合っとる」が漏れるので、そこまで揃っとることを見る。
    const headersOf = (res: Response) => [...res.headers].map(([k, v]) => `${k}: ${v}`).sort();
    expect(headersOf(unknownUser)).toEqual(headersOf(wrongPass));
  });

  it("本文なしの POST は 401（空資格で通らん）", async () => {
    const res = await request("/auth/basic-login", { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("parseBody が解けん JSON 本文でも 401 に落ちる（500 にせん）", async () => {
    const res = await request("/auth/basic-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: BASIC_USER, password: BASIC_PASS }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(LOGIN_FAILED_HTML);
  });

  it("boundary と中身が食い違う multipart でも 401（parseBody の例外を握る）", async () => {
    const res = await request("/auth/basic-login", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----broken" },
      body: "not-actually-multipart",
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(LOGIN_FAILED_HTML);
  });

  it("BASIC_AUTH_* 未設定なら空資格でも 401（設定漏れで全開にせん）", async () => {
    const res = await postForm(
      "/auth/basic-login",
      { username: "", password: "" },
      { BASIC_AUTH_USER: undefined, BASIC_AUTH_PASS: undefined },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("BASIC_AUTH_PASS が空文字なら空パスワードで通らん", async () => {
    const res = await postForm(
      "/auth/basic-login",
      { username: BASIC_USER, password: "" },
      { BASIC_AUTH_PASS: "" },
    );
    expect(res.status).toBe(401);
  });

  it("署名鍵が空白だけなら 503 を返し、Cookie を張らん", async () => {
    const res = await postForm(
      "/auth/basic-login",
      { username: BASIC_USER, password: BASIC_PASS },
      { AUTH_SIGNING_KEY: "   " },
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("signing_key_not_configured");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  // 以前は btoa が Latin-1 の範囲外で throw し、捕まえられんまま 500 になっとった。
  // 未認証の誰でも POST 一発で 5xx を作れ、5xx フックが Slack へ通知を撃つ経路やった。
  it("非 Latin-1 のパスワードでも 500 やのうて 401 を返す", async () => {
    const res = await postForm("/auth/basic-login", {
      username: BASIC_USER,
      password: "パスワード",
    });
    expect(res.status).toBe(401);
  });

  it("非 Latin-1 のユーザー名でも 401 を返す", async () => {
    const res = await postForm("/auth/basic-login", {
      username: "管理者",
      password: BASIC_PASS,
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/session", () => {
  it("未認証なら 401 でトークンを発行せん", async () => {
    const res = await request("/auth/session", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("Cookie の既存セッションから token と expiresAt を再発行する", async () => {
    const token = await signAppJwt(LOCAL_USER_EMAIL, SIGNING_KEY);
    const before = Math.floor(Date.now() / 1000);
    const res = await request("/auth/session", {
      method: "POST",
      headers: { Cookie: `${APP_AUTH_COOKIE}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await readJson<{ token: string; expiresAt: number }>(res);
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token"]);
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + NINETY_DAYS_SEC);
    expect(body.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + NINETY_DAYS_SEC);
  });

  it("再発行した token は /api/me で通る", async () => {
    const res = await request("/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const { token } = await readJson<{ token: string }>(res);
    const me = await request("/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: LOCAL_USER_EMAIL });
  });

  it("この経路は Cookie を張らず、本文の token だけを返す", async () => {
    const res = await request("/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("期限切れ Cookie では再発行できん（無期限に延命させん）", async () => {
    const token = await forgeJwt({ email: LOCAL_USER_EMAIL, exp: 1_000_000 });
    const res = await request("/auth/session", {
      method: "POST",
      headers: { Cookie: `${APP_AUTH_COOKIE}=${token}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("別の鍵で署名された JWT では再発行できん", async () => {
    const token = await signAppJwt(LOCAL_USER_EMAIL, "attacker-signing-key");
    const res = await request("/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("署名鍵が未設定なら 503 を JSON で返す", async () => {
    const res = await request(
      "/auth/session",
      { method: "POST", headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
      { AUTH_SIGNING_KEY: undefined },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "signing_key_not_configured" });
  });

  it("提示された JWT の email をそのまま引き継ぎ、運用者へ昇格させん", async () => {
    const token = await signAppJwt("intruder@example.com", SIGNING_KEY);
    const res = await request("/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const { token: reissued } = await readJson<{ token: string }>(res);
    const me = await request("/me", { headers: { Authorization: `Bearer ${reissued}` } });
    expect(await me.json()).toMatchObject({ email: "intruder@example.com", isLocal: false });
  });

  it("GET では受け付けん（404）", async () => {
    const res = await request("/auth/session");
    expect(res.status).toBe(404);
  });
});
