// POST /api/chat/:id/suggest — 次の発話候補（選択肢・おすすめ返信）を返す（RIT-203）。
import { createFileRoute } from "@tanstack/react-router";

import { handleSuggestRequest } from "../../../../server/api-suggest";

export const Route = createFileRoute("/api/chat/$id_/suggest")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleSuggestRequest(params.id, request),
    },
  },
});
