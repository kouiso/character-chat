// DELETE /api/chat/:id/memory — 記憶リセット（RIT-196）。?conversationId を付けるとその会話だけ、無ければキャラ全会話。
import { createFileRoute } from "@tanstack/react-router";

import { handleMemoryResetRequest } from "../../../../server/api-memory";

export const Route = createFileRoute("/api/chat/$id_/memory")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleMemoryResetRequest(params.id, request),
    },
  },
});
