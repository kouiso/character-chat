// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const startFetch = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());

vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: startFetch } }));
vi.mock("./server/chat-room", () => ({ ChatRoom: class {} }));

const { default: worker } = await import("./worker");
const { unstable_readConfig: readWranglerConfig } = await import("wrangler");

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

  it.each(["staging"])(
    "env.%s も wrangler が解決した結果で静的ファイルを Worker に先に通す",
    (name) => {
      // env 側に assets が無いと top-level を継承するので、生の JSON では確かめきれん。
      // deploy と同じ解決を通した結果で見る。
      const resolved = readWranglerConfig({
        config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
        env: name,
      });
      expect(resolved.name).toBe(`adult-ai-v2-${name}`);
      expect(resolved.assets?.run_worker_first).toBe(true);
      expect(resolved.workers_dev).toBe(false);
      expect(resolved.preview_urls).toBe(false);
    },
  );

  it("staging でも認証情報が未設定なら 503 で閉じる", async () => {
    // staging は secrets.required を継承せず、未設定のまま deploy できる。入口で閉じるしかない。
    const { env, assetFetch } = createEnv(200, { APP_ENV: "staging" });
    const response = await call(
      new Request("https://example.com/assets/main.js", { headers: { authorization } }),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(assetFetch).not.toHaveBeenCalled();
    expect(startFetch).not.toHaveBeenCalled();
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

describe("Worker の HTTP 以外の入口", () => {
  it("HTTP を受ける入口は認証つきの fetch だけ", () => {
    // queue は Cloudflare の Queue からしか呼ばれん。scheduled/email 等を足すなら認証の要否を見直す。
    expect(Object.keys(worker).sort()).toEqual(["fetch", "queue"]);
  });

  it("queue はアプリに渡さず、仕事ごとに受け取りを返す", async () => {
    const messages = [
      {
        body: { kind: "embed-memory", characterId: "c1", conversationId: "v1" },
        ack: vi.fn(),
        retry: vi.fn(),
      },
      { body: "GET / HTTP/1.1", ack: vi.fn(), retry: vi.fn() },
    ];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await worker.queue({ messages } as unknown as Parameters<typeof worker.queue>[0]);
    for (const message of messages) {
      expect(message.ack).toHaveBeenCalledOnce();
      expect(message.retry).not.toHaveBeenCalled();
    }
    expect(startFetch).not.toHaveBeenCalled();
    // 形の合わん中身は記録にも出さん（何が入っとるか分からんので）。
    expect(JSON.stringify(warn.mock.calls)).not.toContain("GET / HTTP/1.1");
    info.mockRestore();
    warn.mockRestore();
  });
});
