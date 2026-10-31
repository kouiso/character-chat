// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const startFetch = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());

vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: startFetch } }));
vi.mock("./server/chat-room", () => ({ ChatRoom: class {} }));

const { default: worker } = await import("./worker");

const credentials = { BASIC_AUTH_USERNAME: "reader", BASIC_AUTH_PASSWORD: "test-only-pass" };
const authorization = `Basic ${Buffer.from("reader:test-only-pass").toString("base64")}`;

const createEnv = (assetStatus = 404, settings: Record<string, string> = credentials) => {
  const assetFetch = vi.fn(
    async () => new Response(assetStatus === 404 ? null : "asset", { status: assetStatus }),
  );
  return {
    env: { ...settings, ASSETS: { fetch: assetFetch } } as unknown as Cloudflare.Env,
    assetFetch,
  };
};

const call = (request: Request, env: Cloudflare.Env): Promise<Response> =>
  worker.fetch(request as Parameters<typeof worker.fetch>[0], env);

beforeEach(() => {
  startFetch.mockReset();
  startFetch.mockResolvedValue(new Response("app", { headers: { "cache-control": "public" } }));
});

describe("Worker 入口の BASIC 認証", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/chat/example"],
    ["GET", "/assets/main.js"],
    ["HEAD", "/assets/main.js"],
    ["GET", "/api/health"],
    ["GET", "/api/chat/example/history?conversationId=c1"],
    ["POST", "/api/chat/example"],
    ["OPTIONS", "/api/chat/example"],
    ["GET", "/api/media/message-1"],
  ])("%s %s は認証なしだと静的ファイルにもアプリにも渡さない", async (method, path) => {
    const { env, assetFetch } = createEnv(200);
    const response = await call(new Request(`https://example.com${path}`, { method }), env);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(assetFetch).not.toHaveBeenCalled();
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("誤ったパスワードでは通さない", async () => {
    const { env, assetFetch } = createEnv(200);
    const wrong = `Basic ${Buffer.from("reader:wrong").toString("base64")}`;
    const response = await call(
      new Request("https://example.com/", { headers: { authorization: wrong } }),
      env,
    );
    expect(response.status).toBe(401);
    expect(assetFetch).not.toHaveBeenCalled();
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("認証情報が未設定なら 503 で閉じる", async () => {
    const { env, assetFetch } = createEnv(200, {});
    const response = await call(
      new Request("https://example.com/", { headers: { authorization } }),
      env,
    );
    expect(response.status).toBe(503);
    expect(assetFetch).not.toHaveBeenCalled();
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("認証済みの静的ファイルは共有キャッシュさせずに返す", async () => {
    const { env } = createEnv(200);
    const response = await call(
      new Request("https://example.com/assets/main.js", { headers: { authorization } }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(startFetch).not.toHaveBeenCalled();
  });

  it("認証済みで静的ファイルが無ければアプリへ渡す", async () => {
    const { env } = createEnv(404);
    const response = await call(
      new Request("https://example.com/chat/example", { headers: { authorization } }),
      env,
    );
    expect(await response.text()).toBe("app");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(startFetch).toHaveBeenCalledOnce();
  });

  it("POST は静的ファイルを見ずにアプリへ渡す", async () => {
    const { env, assetFetch } = createEnv(200);
    await call(
      new Request("https://example.com/api/chat/example", {
        method: "POST",
        headers: { authorization },
        body: "{}",
      }),
      env,
    );
    expect(assetFetch).not.toHaveBeenCalled();
    expect(startFetch).toHaveBeenCalledOnce();
  });

  it("静的ファイルも Worker を先に通す設定になっている", () => {
    // run_worker_first が外れると、静的ファイルは Worker を通らずに配信され認証を素通りする。
    const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, "")) as {
      assets?: { run_worker_first?: unknown };
      env?: Record<string, { assets?: { run_worker_first?: unknown } }>;
    };
    expect(config.assets?.run_worker_first).toBe(true);
    for (const environment of Object.values(config.env ?? {})) {
      if (environment.assets) expect(environment.assets.run_worker_first).toBe(true);
    }
  });

  it("アプリが例外を投げても中身を出さず 500 を返す", async () => {
    const { env } = createEnv(404);
    startFetch.mockRejectedValue(new Error("secret detail"));
    const response = await call(
      new Request("https://example.com/", { headers: { authorization } }),
      env,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
