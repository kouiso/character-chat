import handler from "@tanstack/react-start/server-entry";

import { preventSharedCaching, requireBasicAuth } from "./server/basic-auth";

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
} satisfies ExportedHandler<Cloudflare.Env>;
