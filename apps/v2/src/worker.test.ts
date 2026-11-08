// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerEntryEnv } from "./worker";

const startFetch = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());

vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: startFetch } }));
vi.mock("./server/chat-room", () => ({ ChatRoom: class {} }));
vi.mock("./server/proactive-scheduler", () => ({ ProactiveScheduler: class {} }));

const { default: worker } = await import("./worker");
const { unstable_readConfig: readWranglerConfig } = await import("wrangler");

const credentials = { BASIC_AUTH_USERNAME: "reader", BASIC_AUTH_PASSWORD: "test-only-pass" };
const authorization = `Basic ${Buffer.from("reader:test-only-pass").toString("base64")}`;

const createEnv = (assetStatus = 404, settings: Record<string, string> = credentials) => {
  const assetFetch = vi.fn(
    async () => new Response(assetStatus === 404 ? null : "asset", { status: assetStatus }),
  );
  return {
    env: { ...settings, ASSETS: { fetch: assetFetch } } satisfies WorkerEntryEnv,
    assetFetch,
  };
};

const call = (request: Request, env: WorkerEntryEnv): Promise<Response> =>
  worker.fetch(request, env);

beforeEach(() => {
  startFetch.mockReset();
  startFetch.mockResolvedValue(new Response("app", { headers: { "cache-control": "public" } }));
});

const UNAUTHENTICATED_PROBES = [
  ["GET", "/"],
  ["GET", "/chat/example"],
  ["GET", "/assets/main.js"],
  ["HEAD", "/assets/main.js"],
  ["GET", "/api/health"],
  ["GET", "/api/chat/example/history?conversationId=c1"],
  ["POST", "/api/chat/example"],
  ["OPTIONS", "/api/chat/example"],
  ["GET", "/api/media/message-1"],
  ["GET", "/api/characters"],
  ["GET", "/api/characters/example"],
  ["GET", "/characters/example"],
  ["GET", "/characters/new"],
  ["POST", "/api/characters/example/restore"],
  ["GET", "/api/characters/example/versions"],
  ["GET", "/api/characters/example/versions/1"],
  ["GET", "/api/proactive/characters/example/settings"],
  ["GET", "/api/push/vapid-key"],
  ["POST", "/api/push/subscriptions"],
] as const;

// routes/ のファイル名と URL を区切りごとに突き合わせる（$id は任意の 1 区切り、末尾 _ は入れ子を外す印、index は親）。
const routeMatches = (file: string, path: string): boolean => {
  const routeSegments = file
    .replace(/\.tsx?$/, "")
    .split("/")
    .filter((segment) => segment !== "index")
    .map((segment) => segment.replace(/_$/, ""));
  const pathSegments = path.split("/").filter(Boolean);
  return (
    routeSegments.length === pathSegments.length &&
    routeSegments.every(
      (segment, index) => segment.startsWith("$") || segment === pathSegments[index],
    )
  );
};

describe("Worker 入口の BASIC 認証", () => {
  // 経路を足して確認表へ足し忘れると、その経路の認証は試験されんまま出る。
  it("routes/ の全ファイルが認証なしの確認表に載っとる", () => {
    const routesDir = fileURLToPath(new URL("./routes", import.meta.url));
    const files = readdirSync(routesDir, { recursive: true, encoding: "utf8" })
      .map((file) => file.split(sep).join("/"))
      .filter((file) => /\.tsx?$/.test(file) && !file.endsWith("__root.tsx"));
    expect(files.length).toBeGreaterThan(0);
    const probed = UNAUTHENTICATED_PROBES.map(([, path]) => path.split("?")[0]);
    const missing = files.filter((file) => !probed.some((path) => routeMatches(file, path)));
    expect(missing).toEqual([]);
  });

  it.each(UNAUTHENTICATED_PROBES)(
    "%s %s は認証なしだと静的ファイルにもアプリにも渡さない",
    async (method, path) => {
      const { env, assetFetch } = createEnv(200);
      const response = await call(new Request(`https://example.com${path}`, { method }), env);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
      expect(assetFetch).not.toHaveBeenCalled();
      expect(startFetch).not.toHaveBeenCalled();
    },
  );

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

  it.each([
    ["rag", "adult-ai-v2"],
    ["staging", "adult-ai-v2-staging"],
  ])("env.%s も wrangler が解決した結果で静的ファイルを Worker に先に通す", (name, workerName) => {
    // env 側に assets が無いと top-level を継承するので、生の JSON では確かめきれん。
    // deploy と同じ解決を通した結果で見る。
    const resolved = readWranglerConfig({
      config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
      env: name,
    });
    expect(resolved.name).toBe(workerName);
    expect(resolved.assets?.run_worker_first).toBe(true);
    expect(resolved.workers_dev).toBe(false);
    expect(resolved.preview_urls).toBe(false);
  });

  it("staging でも認証情報が未設定なら 503 で閉じる", async () => {
    // staging も secrets.required で deploy 時に止まるが、出した後に secret を消された時は入口で閉じる。
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
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await call(
      new Request("https://example.com/", { headers: { authorization } }),
      env,
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(errors.mock.calls.map((args) => JSON.parse(String(args[0])))).toEqual([
      { event: "worker_request_failed", method: "GET", errorName: "Error" },
    ]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret detail");
    errors.mockRestore();
  });
});

describe("Worker の HTTP 以外の入口", () => {
  it("HTTP を受ける入口は認証つきの fetch だけ", () => {
    // queue は Cloudflare の Queue からしか呼ばれん。scheduled/email 等を足すなら認証の要否を見直す。
    expect(Object.keys(worker).sort()).toEqual(["fetch", "queue"]);
  });

  it("queue は記憶の consumer だけへ渡し、アプリの fetch は通さん", async () => {
    const { consumeMemoryJobs } = await import("./server/memory-queue");
    expect(worker.queue).toBe(consumeMemoryJobs);
  });
});
