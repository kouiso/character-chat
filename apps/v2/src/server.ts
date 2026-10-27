import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env } from "cloudflare:workers";

import { handleConsumerApi } from "./server/consumer-api";
import { checkBasicAuth } from "./server/entry-auth";

export { ChatRoom } from "./server/chat-room";
export { ProactiveRecipient } from "./server/proactive-recipient";

export default createServerEntry({
  async fetch(request, options) {
    const rejection = checkBasicAuth(request, env);
    if (rejection) return rejection;
    const consumer = await handleConsumerApi(request, env);
    if (consumer) return consumer;

    if (request.method === "GET" || request.method === "HEAD") {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return handler.fetch(request, options);
  },
});
