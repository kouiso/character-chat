// GET /api/chat/:id/events?conversationId=…&requestId=… — 部屋に控えた出来事を、
// 続きの番号（Last-Event-ID）から SSE で配り直す口（RIT-87/RIT-65）。
import { createFileRoute } from "@tanstack/react-router";

import { handleEventsRequest } from "../../../../server/api-chat";

export const Route = createFileRoute("/api/chat/$id_/events")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleEventsRequest(params.id, request),
    },
  },
});
