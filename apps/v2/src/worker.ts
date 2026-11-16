import handler from "@tanstack/react-start/server-entry";

import { describeError } from "@v2/db";

import { preventSharedCaching, requireBasicAuth, type BasicAuthConfig } from "./server/basic-auth";
import { reportFailure } from "./server/log";
import { consumeMemoryJobs } from "./server/memory-queue";

export { ChatRoom } from "./server/chat-room";
export { ProactiveScheduler } from "./server/proactive-scheduler";

// 入口が触る束縛だけを型にしておくと、テストが Env 全体を偽装せずに済む。
export type WorkerEntryEnv = BasicAuthConfig & {
  ASSETS: Pick<Fetcher, "fetch">;
  V2_CF_ACCESS?: string;
};

// vite が内容ハッシュ付きで吐く /assets/* はURLごと不変なので長期キャッシュさせる。
const HASHED_ASSET_PATH = /^\/assets\/.+/;
const IMMUTABLE_ASSET_CACHE = "private, max-age=31536000, immutable";
// public/ 直下の資産は中身が替わりうるので、ETag 再検証に委ねる。ASSETS が方針を
// 宣言しとる時はそちらを優先する。
const REVALIDATABLE_ASSET_CACHE = "private, no-cache";

const markImmutableAsset = (response: Response): Response => {
  const marked = new Response(response.body, response);
  marked.headers.set("cache-control", IMMUTABLE_ASSET_CACHE);
  return marked;
};

const revalidatableAsset = (response: Response): Response => {
  if (response.headers.has("cache-control")) return response;
  const marked = new Response(response.body, response);
  marked.headers.set("cache-control", REVALIDATABLE_ASSET_CACHE);
  return marked;
};

const fetchEntry = async (request: Request, env: WorkerEntryEnv): Promise<Response> => {
  // Cloudflare Access が入口で認証済みの環境では Basic 認証は二重になり無用なので外す。
  if (env.V2_CF_ACCESS !== "1") {
    const denied = await requireBasicAuth(request, env);
    if (denied) return denied;
  }
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) {
        const hashed = HASHED_ASSET_PATH.test(new URL(request.url).pathname);
        return preventSharedCaching(hashed ? markImmutableAsset(asset) : revalidatableAsset(asset));
      }
    }
    return preventSharedCaching(await handler.fetch(request));
  } catch (error) {
    // 例外の本文は会話や接続先の詳細を含みうるので、名前だけを残す。
    reportFailure(env, {
      event: "worker_request_failed",
      level: "error",
      method: request.method,
      reason: describeError(error),
    });
    return new Response(null, { status: 500, headers: { "cache-control": "private, no-store" } });
  }
};

export default {
  fetch: fetchEntry,
  queue: consumeMemoryJobs,
} satisfies ExportedHandler<Cloudflare.Env>;
