import handler from "@tanstack/react-start/server-entry";

import { preventSharedCaching, requireBasicAuth, type BasicAuthConfig } from "./server/basic-auth";
import { consumeMemoryJobs } from "./server/memory-queue";

export { ChatRoom } from "./server/chat-room";

// 入口が触る束縛だけを型にしておくと、テストが Env 全体を偽装せずに済む。
export type WorkerEntryEnv = BasicAuthConfig & { ASSETS: Pick<Fetcher, "fetch"> };

const fetchEntry = async (request: Request, env: WorkerEntryEnv): Promise<Response> => {
  const denied = await requireBasicAuth(request, env);
  if (denied) return denied;
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return preventSharedCaching(asset);
    }
    return preventSharedCaching(await handler.fetch(request));
  } catch (error) {
    // 例外の本文は会話や接続先の詳細を含みうるので、名前だけを残す。
    console.error(
      JSON.stringify({
        event: "worker_request_failed",
        method: request.method,
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    );
    return new Response(null, { status: 500, headers: { "cache-control": "private, no-store" } });
  }
};

export default {
  fetch: fetchEntry,
  queue: consumeMemoryJobs,
} satisfies ExportedHandler<Cloudflare.Env>;
