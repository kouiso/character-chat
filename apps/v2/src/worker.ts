import handler from "@tanstack/react-start/server-entry";

import { preventSharedCaching, requireBasicAuth } from "./server/basic-auth";
import { handleMemoryJobBatch } from "./server/memory-jobs";

export { ChatRoom } from "./server/chat-room";

export default {
  async fetch(request, env) {
    const denied = await requireBasicAuth(request, env);
    if (denied) return denied;
    try {
      if (request.method === "GET" || request.method === "HEAD") {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return preventSharedCaching(asset);
      }
      return preventSharedCaching(await handler.fetch(request));
    } catch {
      return new Response(null, { status: 500, headers: { "cache-control": "private, no-store" } });
    }
  },
  // Queue は外から呼べる口を持たんので BASIC 認証の対象外（設計書 §4.8）。
  async queue(batch) {
    await handleMemoryJobBatch(batch);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
