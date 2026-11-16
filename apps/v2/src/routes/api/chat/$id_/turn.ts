// GET /api/chat/:id/turn?conversationId=…[&requestId=…] — 進行中の受付の調べ。
// 開き直し・取り下げの 409 の後に、画面が「走っとる受付はどれか」を確かめる口（RIT-87/RIT-65）。
import { createFileRoute } from "@tanstack/react-router";

import { handleTurnRequest } from "../../../../server/api-chat";

export const Route = createFileRoute("/api/chat/$id_/turn")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleTurnRequest(params.id, request),
    },
  },
});
