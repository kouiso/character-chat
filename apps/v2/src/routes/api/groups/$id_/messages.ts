// GET/POST /api/groups/:id/messages — 場の履歴取得と、ユーザー発言＋全員の応答。
import { createFileRoute } from "@tanstack/react-router";

import { handleGroupMessages } from "../../../../server/api-group";

export const Route = createFileRoute("/api/groups/$id_/messages")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGroupMessages(request, params.id),
      POST: ({ request, params }) => handleGroupMessages(request, params.id),
    },
  },
});
