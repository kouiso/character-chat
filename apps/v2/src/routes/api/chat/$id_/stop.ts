// POST /api/chat/:id/stop — 「止める」。画面に出た塊だけ残して返事を畳む（RIT-65）。
import { createFileRoute } from "@tanstack/react-router";

import { handleStopRequest } from "../../../../server/api-chat";

export const Route = createFileRoute("/api/chat/$id_/stop")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleStopRequest(params.id, request),
    },
  },
});
