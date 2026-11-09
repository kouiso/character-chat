// POST /api/stories/:id/chapters — 章の追加（RIT-214）。一覧は GET /api/stories/:id に同梱。
import { createFileRoute } from "@tanstack/react-router";

import { handleChapterPost } from "../../../../server/api-stories";

export const Route = createFileRoute("/api/stories/$id_/chapters")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleChapterPost(params.id, request),
    },
  },
});
